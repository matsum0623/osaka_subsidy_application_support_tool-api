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
  const year_end_date = `${(year + 1).toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-01`;

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
    month_list.push((calcMonth == 1 ? 12 : calcMonth - 1));

    const ym = `${calcYear.toString().padStart(4, '0')}-${calcMonth.toString().padStart(2, '0')}`;

    month_open_hours.push(await calcMonthWorkSummary(schoolId, `${ym}-01`, `${ym}-99`, instructors, ym));
  }

  // Excelファイルの作成
  await createXlsxFile(instructors, month_list, month_open_hours, [
      { offset: 0, label: '合計', data: totalHours },
      { offset: 1, label: '加配1人目', data: additionalHours },
      { offset: 2, label: '加配1人目以外', data: [] },
      { offset: 3, label: '医ケア', data: [] },
      { offset: 4, label: '開所時間外', data: workHoursWithoutOpeningHours },
    ]);

  // S3にアップロード
  return await uploadToS3('additional_instructor_work_hours', '加配情報', year);
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

  // 出力対象のデータに成形する
  const view_data = []
  for (const workHours of Object.values(instructors)) {
    const tmp_data = {
      InstructorName: workHours.InstructorName,
      WorkHours: [
        [], // 合計
        [], // 加配1人目
        [], // 加配1人目以外
        [], // 医ケア
        [], // 開所時間外
      ]
    }

    for (const hours of Object.values(workHours.WorkHours)) {
      tmp_data.WorkHours[0].push(hours.TotalHours);
      tmp_data.WorkHours[1].push(hours.AdditionalHours);
      tmp_data.WorkHours[4].push(hours.WorkHoursWithoutOpeningHours);
    }
    view_data.push(tmp_data);
  }

  // Excelファイルの作成
  await createXlsxFile(view_data, month_list, month_open_hours, [
    { offset: 0, label: '合計' },
    { offset: 1, label: '加配1人目' },
    { offset: 2, label: '加配1人目以外' },
    { offset: 3, label: '医ケア' },
    { offset: 4, label: '開所時間外' },
  ]);

  // S3にアップロード
  return await uploadToS3('additional_instructor_work_hours', '加配情報', year);
}

async function getInstructors(after_school_id, start_date, end_date, additional = false) {
  const instructors = additional ? await instructor.get_additional(after_school_id) : await instructor.get_list(after_school_id);
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
          } else {
              instructors[instructorId].WorkHours[ym].WorkHoursWithinOpeningHours += Math.min(close, instEnd) - Math.max(open, instStart);
              instructors[instructorId].WorkHours[ym].WorkHoursWithoutOpeningHours += instEnd - instStart - Math.max(Math.min(close, instEnd) - Math.max(open, instStart), 0);
          }
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
  sheet.cell(`${DATA_ROWS[DATA_ROWS.length - 1]}1`).value('合計');

  // 月次開所時間合計
  sheet.cell(`A2`).value('月次開所時間合計');
  month_open_hours.forEach((hours, index) => {
    sheet.cell(`${DATA_ROWS[index]}2`).value(convert_int_to_time(hours));
  });

  // 指導員ごとの情報
  base_row = 3
  view_data.forEach((inst_data) => {
    sheet.cell(`A${base_row}`).value(inst_data.InstructorName);
    inst_data.WorkHours.forEach((hours, monthIndex) => {
      sheet.cell(`${DATA_ROWS[monthIndex]}${base_row}`).value(convert_int_to_time(hours));
    });
    const sum = inst_data.WorkHours.reduce((acc, val) => acc + val, 0);
    sheet.cell(`${DATA_ROWS[inst_data.WorkHours.length]}${base_row}`).value(convert_int_to_time(sum));
    base_row++;
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