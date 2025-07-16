const fs = require('fs');
const AWS = require("aws-sdk");
const s3 = new AWS.S3();

const { response_ok, response_403 } = require('lambda_response')
const { daily, instructor } = require('connect_dynamodb')
const { Auth } = require('Auth')
const { convert_time_to_int, convert_int_to_time } = require('Utils')

const XlsxPopulate = require('xlsx-populate');

const SHEET_NAME = '加配情報';
const DATA_ROWS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
const TMP_FILE_NAME = `/tmp/Output.xlsx`;

exports.handler = async (event, context) => {
  const decode_token = Auth.check_id_token(event)
  if(!decode_token){
    return response_403
  }

  const qsp = event.queryStringParameters
  if(qsp == undefined || !qsp.year || !qsp.school_id){
    return response_403
  }

  // 出力ファイルのタイプを取得
  // 設定なしは加配情報
  const file_type = qsp.file_type;

  const schoolId = qsp.school_id;
  const year = parseInt(qsp.year);

  // S3にアップロード
  if(file_type === 'work_summary') {
    return response_ok({ url: await createWorkSummary(schoolId, year) });
  } else {
    return response_ok({ url: await createAdditionalSummary(schoolId, year) });
  }
}

async function createWorkSummary(schoolId, year) {
  const month = 4;  // TODO: 開始月度を指定できるように

  const year_start_date = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-01`;
  const year_end_date = `${(year + 1).toString().padStart(4, '0')}-${(month - 1).toString().padStart(2, '0')}-99`;

  let instructors = await getInstructors(schoolId, year_start_date, year_end_date);

  const month_list = [];
  const month_open_hours = [];
  for (let i = 0; i < 12; i++) {
    let calcMonth = month + i;
    let calcYear = year;

    if (calcMonth > 12) {
      calcYear += 1;
      calcMonth -= 12;
    }
    month_list.push(calcMonth);

    const ym = `${calcYear.toString().padStart(4, '0')}-${calcMonth.toString().padStart(2, '0')}`;

    month_open_hours.push(await calcMonthWorkSummary(schoolId, `${ym}-01`, `${ym}-99`, instructors, ym));
  }
  // 月次開所時間合計を追加
  month_list.push('合計');
  month_open_hours.push(month_open_hours.reduce((acc, val) => acc + val, 0));

  // 出力対象のデータに成形する
  const view_data = []
  for (const workHours of Object.values(instructors)) {
    const tmp_data = {
      InstructorName: workHours.InstructorName,
      WorkHours: [
        [], // 合計
        [], // 開所時間内
        [], // 開所時間率
      ]
    }

    Object.values(workHours.WorkHours).forEach((hours, index) => {
      tmp_data.WorkHours[0].push(hours.TotalHours);
      tmp_data.WorkHours[1].push(hours.WorkHoursWithinOpeningHours);
      tmp_data.WorkHours[2].push(month_open_hours[index] > 0 ? Math.round((hours.WorkHoursWithinOpeningHours / month_open_hours[index]) * 1000) / 1000 : '');
    });
    // 各配列に合計データを計算して追加
    tmp_data.WorkHours[0].push(tmp_data.WorkHours[0].reduce((acc, val) => acc + val, 0));
    tmp_data.WorkHours[1].push(tmp_data.WorkHours[1].reduce((acc, val) => acc + val, 0));
    tmp_data.WorkHours[2].push(month_open_hours[month_open_hours.length - 1] > 0 ? tmp_data.WorkHours[1][tmp_data.WorkHours[1].length - 1] / month_open_hours[month_open_hours.length - 1] : '');
    view_data.push(tmp_data);
  }

  // Excelファイルの作成
  await createXlsxFile(view_data, month_list, month_open_hours, [
    { convert: convert_int_to_time, label: '合計' , style: "time"},
    { convert: convert_int_to_time, label: '開所時間内', style: "time" },
    { label: '開所時間率', style: "percent" },
  ]);

  // S3にアップロード
  return await uploadToS3('work_summary', '勤務サマリ', year);
}

/**
 * 加配情報の集計を行い、Excelファイルを作成してS3にアップロードする
 * @param {string} schoolId 学校ID
 * @param {number} year 年度
 * @returns {string} S3の署名付きURL
 */
async function createAdditionalSummary(schoolId, year) {
  const month = 5;  // TODO: 開始月度を指定できるように
  const closingDate = 15; // TODO: 締め日の設定ができるようにする。学童設定あたりに保持しておく

  // 開始日と終了日作成。開始日は年度＋月＋締め日翌日、終了日は翌年度＋前月＋締め日
  const year_start_date = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${(closingDate + 1).toString().padStart(2, '0')}`;
  const year_end_date = `${(year + 1).toString().padStart(4, '0')}-${(month - 1).toString().padStart(2, '0')}-${closingDate.toString().padStart(2, '0')}`;

  let instructors = await getInstructors(schoolId, year_start_date, year_end_date, true);

  const month_list = [];
  const month_open_hours = [];
  for (let i = 0; i < 12; i++) {
    let calcMonth = month + i;
    let calcYear = year;

    if (calcMonth > 12) {
      calcYear += 1;
      calcMonth -= 12;
    }
    month_list.push((calcMonth == 1 ? 12 : calcMonth - 1));

    const ym = `${calcYear.toString().padStart(4, '0')}-${calcMonth.toString().padStart(2, '0')}`;
    const prevMonth = calcMonth === 1 ? 12 : calcMonth - 1;
    const prevYear = calcMonth === 1 ? calcYear - 1 : calcYear;

    const startDate = `${prevYear.toString().padStart(4, '0')}-${prevMonth.toString().padStart(2, '0')}-${(closingDate + 1).toString().padStart(2, '0')}`;
    const endDate = `${calcYear.toString().padStart(4, '0')}-${calcMonth.toString().padStart(2, '0')}-${closingDate.toString().padStart(2, '0')}`;

    month_open_hours.push(await calcMonthWorkSummary(schoolId, startDate, endDate, instructors, ym));
  }
  // 月次開所時間合計を追加
  month_list.push('合計');
  month_open_hours.push(month_open_hours.reduce((acc, val) => acc + val, 0));

  // 出力対象のデータに成形する
  const view_data = []
  for (const workHours of Object.values(instructors)) {
    const tmp_data = {
      InstructorName: workHours.InstructorName,
      WorkHours: [
        [], // 合計
        [], // 加配1人目
        [0,0,0,0,0,0,0,0,0,0,0,0,0], // 加配1人目以外
        [0,0,0,0,0,0,0,0,0,0,0,0,0], // 医ケア
        [], // 開所時間外
      ]
    }

    Object.values(workHours.WorkHours).forEach((hours) => {
      tmp_data.WorkHours[0].push(hours.TotalHours);
      tmp_data.WorkHours[1].push(hours.AdditionalHours);
      tmp_data.WorkHours[4].push(hours.WorkHoursWithoutOpeningHours);
    });
    // 各配列に合計データを計算して追加
    tmp_data.WorkHours[0].push(tmp_data.WorkHours[0].reduce((acc, val) => acc + val, 0));
    tmp_data.WorkHours[1].push(tmp_data.WorkHours[1].reduce((acc, val) => acc + val, 0));
    tmp_data.WorkHours[4].push(tmp_data.WorkHours[4].reduce((acc, val) => acc + val, 0));
    view_data.push(tmp_data);
  }

  // Excelファイルの作成
  await createXlsxFile(view_data, month_list, month_open_hours, [
    { convert: convert_int_to_time, label: '合計', style: "time"},
    { convert: convert_int_to_time, label: '加配1人目', style: "time"},
    { convert: convert_int_to_time, label: '加配1人目以外', style: "time"},
    { convert: convert_int_to_time, label: '医ケア', style: "time"},
    { convert: convert_int_to_time, label: '開所時間外', style: "time"},
  ]);

  // S3にアップロード
  return await uploadToS3('additional_instructor_work_hours', '加配情報', year);
}

async function getInstructors(after_school_id, start_date, end_date, additional = false) {
  const instructors = additional ? await instructor.get_additional(after_school_id) : await instructor.get_all(after_school_id);
  const res_instructors = {};
  instructors.forEach(item => {
    // 在職期間が指定年度内であることをチェック
    if ((item.RetirementDate ? item.RetirementDate : '2099-12-31') < start_date || end_date < (item.HireDate ? item.HireDate : '1900-01-01')) {
        return; // 在職期間が指定年度外の場合はスキップ
    }
    const instructorId = item.SK.split('#')[1];
    res_instructors[instructorId] = {
      InstructorName: item.Name,
      WorkHours: {}
    };
  });

  return res_instructors;
}

async function calcMonthWorkSummary(schoolId, startDate, endDate, instructors, ym) {
  const daily_data = await daily.get_list_between(schoolId, startDate, endDate);

  for (const inst in instructors) {
    instructors[inst].WorkHours[ym] = {
      TotalHours: 0,
      WorkHoursWithinOpeningHours: 0,
      WorkHoursWithoutOpeningHours: 0,
      AdditionalHours: 0,
    };
  }

  let open_hours_sum = 0;

  daily_data.forEach(item => {
    try {
      const open = convert_time_to_int(item.OpenTime.start);
      const close = convert_time_to_int(item.OpenTime.end);
      open_hours_sum += close - open;

      item.Details.InstructorWorkHours.forEach(workHour => {
        const instructorId = workHour.InstructorId;
        if (instructors[instructorId]) {
          const instStart = convert_time_to_int(workHour.StartTime);
          const instEnd = convert_time_to_int(workHour.EndTime);

          instructors[instructorId].WorkHours[ym].TotalHours += instEnd - instStart;

          if (workHour.AdditionalCheck) {
              instructors[instructorId].WorkHours[ym].AdditionalHours += instEnd - instStart;
          }
          instructors[instructorId].WorkHours[ym].WorkHoursWithinOpeningHours += Math.min(close, instEnd) - Math.max(open, instStart);
          instructors[instructorId].WorkHours[ym].WorkHoursWithoutOpeningHours += instEnd - instStart - Math.max(Math.min(close, instEnd) - Math.max(open, instStart), 0);
        }
      });
    } catch (error) {
        console.error(item);
        throw error;
    }
  });

  return open_hours_sum;
}

async function createXlsxFile(view_data, month_list, month_open_hours, row_labels) {
  const book = await XlsxPopulate.fromBlankAsync();
  book.sheet(0).name(SHEET_NAME);
  const sheet = book.sheet(0);

  // ヘッダーの設定
  sheet.cell('A1').value('指導員名');
  DATA_ROWS.forEach((col, index) => {
    sheet.cell(`${col}1`).value(`${month_list[index]}月`);
  });

  // 月次開所時間合計
  sheet.cell(`A2`).value('月次開所時間合計');
  month_open_hours.forEach((hours, index) => {
    sheet.cell(`${DATA_ROWS[index]}2`).value(convert_int_to_time(hours));
  });

  // 指導員ごとの情報
  base_row = 3
  view_data.forEach((inst_data) => {
    sheet.cell(`A${base_row}`).value(inst_data.InstructorName);
    inst_data.WorkHours.forEach((data, index) => {
      const row_settings = row_labels[index];
      sheet.cell(`B${base_row}`).value(row_settings.label);
      data.forEach((hours, monthIndex) => {
        const cell_name = `${DATA_ROWS[monthIndex]}${base_row}`;
        sheet.cell(cell_name).value(row_settings.convert ? row_settings.convert(hours): hours);
        switch (row_settings.style) {
          case "time":
            sheet.cell(cell_name).style("numberFormat", "[h]:mm")
            break;
            case "percent":
            sheet.cell(cell_name).style("numberFormat", "0.0%")
            break;
          default:
            break;
        }
      });
      base_row++;
    });
  })
  await book.toFileAsync(TMP_FILE_NAME);
}

async function uploadToS3(s3_dir, prefix, year) {
  const random_number =  Math.floor(1000000000000000 + Math.random() * 9000000000000000).toString();
  const timestamp = (new Date()).getTime()
  const key = `${s3_dir}/${timestamp}_${random_number}.xlsx`
  try {
    await s3.putObject({
      Bucket: process.env.FILE_DOWNLOAD_BUCKET_NAME,
      Key: key,
      Body: fs.createReadStream(TMP_FILE_NAME),
    }).promise();

  } catch (error) {
    console.log(error)
  }
  const signed_url = await s3.getSignedUrl('getObject', {
    Bucket: process.env.FILE_DOWNLOAD_BUCKET_NAME,
    Key: key,
    Expires: 60,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(`${prefix}_${year}_${timestamp}.xlsx`)}"`,
  })
  return signed_url;
}