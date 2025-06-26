const fs = require('fs');
const AWS = require("aws-sdk");
const s3 = new AWS.S3();

const { response_ok, response_403 } = require('lambda_response')
const { daily, instructor } = require('connect_dynamodb')
const { Auth } = require('Auth')

const XlsxPopulate = require('xlsx-populate');

const SHEET_NAME = '加配情報';
const DATA_ROWS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
const TMP_FILE_NAME = `/tmp/Output.xlsx`;
const S3_DIR = 'additional_instructor_work_hours';

exports.handler = async (event, context) => {
  const decode_token = Auth.check_id_token(event)
  if(!decode_token){
    return response_403
  }

  const qsp = event.queryStringParameters
  if(qsp == undefined || !qsp.year || !qsp.school_id){
    return response_403
  }

  const schoolId = qsp.school_id;
  const year = parseInt(qsp.year);
  const month = 5;  // TODO: 開始月度を指定できるように
  const closingDate = 15; // TODO: 締め日の設定ができるようにする。学童設定あたりに保持しておく

  // 開始日と終了日作成。開始日は年度＋月＋締め日翌日、終了日は翌年度＋前月＋締め日
  const year_start_date = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${(closingDate + 1).toString().padStart(2, '0')}`;
  const year_end_date = `${(year + 1).toString().padStart(4, '0')}-${(month - 1).toString().padStart(2, '0')}-${closingDate.toString().padStart(2, '0')}`;

  let additionalInstructors = await getAdditionalInstructors(schoolId, year_start_date, year_end_date);

  const month_list = [];
  for (let i = 0; i < 12; i++) {
    let calcMonth = month + i;
    let calcYear = year;

    if (calcMonth > 12) {
      calcYear += 1;
      calcMonth -= 12;
    }
    month_list.push(calcMonth);

    const ym = `${calcYear.toString().padStart(4, '0')}-${calcMonth.toString().padStart(2, '0')}`;
    const prevMonth = calcMonth === 1 ? 12 : calcMonth - 1;
    const prevYear = calcMonth === 1 ? calcYear - 1 : calcYear;

    const startDate = `${prevYear.toString().padStart(4, '0')}-${prevMonth.toString().padStart(2, '0')}-${(closingDate + 1).toString().padStart(2, '0')}`;
    const endDate = `${calcYear.toString().padStart(4, '0')}-${calcMonth.toString().padStart(2, '0')}-${closingDate.toString().padStart(2, '0')}`;

    additionalInstructors = await calcMonthWorkSummary(schoolId, startDate, endDate, additionalInstructors, ym);
  }

  // Excelファイルの作成
  await createXlsxFile(additionalInstructors, month_list);

  // S3にアップロード
  const signed_url = await uploadToS3(year);

  return response_ok({ url: signed_url });
}

async function getAdditionalInstructors(after_school_id, start_date, end_date) {
  const instructors = await instructor.get_additional(after_school_id)
  const additionalInstructors = {};
  instructors.forEach(item => {
    // 在職期間が指定年度内であることをチェック
    if ((item.RetirementDate ? item.RetirementDate : '2099-12-31') < start_date || end_date < (item.HireDate ? item.HireDate : '1900-01-01')) {
        return; // 在職期間が指定年度外の場合はスキップ
    }
    const instructorId = item.SK.split('#')[1];
    additionalInstructors[instructorId] = {
      InstructorName: item.Name,
      WorkHours: {}
    };
  });

  return additionalInstructors;
}

function convertTimeToInt(timeStr) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours + minutes / 60;
}

function convertIntToTime(intTime) {
  const hour = Math.floor(intTime);
  const minute = Math.round((intTime - hour) * 60);
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

async function calcMonthWorkSummary(schoolId, startDate, endDate, additionalInstructors, ym) {
  const daily_data = await daily.get_list_between(schoolId, startDate, endDate);

  for (const inst in additionalInstructors) {
    additionalInstructors[inst].WorkHours[ym] = {
      TotalHours: 0,
      WorkHoursWithinOpeningHours: 0,
      WorkHoursWithoutOpeningHours: 0,
      AdditionalHours: 0,
    };
  }

  daily_data.forEach(item => {
    try {
      const open = convertTimeToInt(item.OpenTime.start);
      const close = convertTimeToInt(item.OpenTime.end);

      item.Details.InstructorWorkHours.forEach(workHour => {
        const instructorId = workHour.InstructorId;
        if (additionalInstructors[instructorId]) {
          const instStart = convertTimeToInt(workHour.StartTime);
          const instEnd = convertTimeToInt(workHour.EndTime);

          additionalInstructors[instructorId].WorkHours[ym].TotalHours += instEnd - instStart;

          if (workHour.AdditionalCheck) {
              additionalInstructors[instructorId].WorkHours[ym].AdditionalHours += instEnd - instStart;
          } else {
              additionalInstructors[instructorId].WorkHours[ym].WorkHoursWithinOpeningHours += Math.min(close, instEnd) - Math.max(open, instStart);
              additionalInstructors[instructorId].WorkHours[ym].WorkHoursWithoutOpeningHours += instEnd - instStart - Math.max(Math.min(close, instEnd) - Math.max(open, instStart), 0);
          }
        }
      });
    } catch (error) {
        console.error(item);
        throw error;
    }
  });

  return additionalInstructors;
}

async function createXlsxFile(additionalInstructors, month_list) {
  const book = await XlsxPopulate.fromBlankAsync();
  book.sheet(0).name(SHEET_NAME);
  const sheet = book.sheet(0);

  base_row = 2
  // ヘッダーの設定
  sheet.cell('A1').value('指導員名');
  DATA_ROWS.forEach((col, index) => {
    sheet.cell(`${col}1`).value(`${month_list[index]}月`);
  });
  sheet.cell(`${DATA_ROWS[DATA_ROWS.length - 1]}1`).value('合計');
  // 指導員ごとの情報
  for (const workHours of Object.values(additionalInstructors)) {
    const totalHours = [];
    const workHoursWithinOpeningHours = [];
    const workHoursWithoutOpeningHours = [];
    const additionalHours = [];

    for (const hours of Object.values(workHours.WorkHours)) {
      totalHours.push(hours.TotalHours);
      workHoursWithinOpeningHours.push(hours.WorkHoursWithinOpeningHours);
      workHoursWithoutOpeningHours.push(hours.WorkHoursWithoutOpeningHours);
      additionalHours.push(hours.AdditionalHours);
    }

    sheet.cell(`A${base_row}`).value(workHours.InstructorName);
    const rowLabels = [
      { offset: 0, label: '合計', data: totalHours },
      { offset: 1, label: '加配1人目', data: additionalHours },
      { offset: 2, label: '加配1人目以外', data: [] },
      { offset: 3, label: '医ケア', data: [] },
      { offset: 4, label: '開所時間外', data: workHoursWithoutOpeningHours },
    ];
    rowLabels.forEach(({ data, offset, label }) => {
      sheet.cell(`B${base_row + offset}`).value(label);
      data.forEach((hours, index) => {
        sheet.cell(`${DATA_ROWS[index]}${base_row + offset}`).value(convertIntToTime(hours));
      });
      const sum = data.reduce((acc, val) => acc + val, 0);
      sheet.cell(`${DATA_ROWS[data.length]}${base_row + offset}`).value(convertIntToTime(sum));
    });

    base_row += 5;
  }
  await book.toFileAsync(TMP_FILE_NAME);
}

async function uploadToS3(year) {
  const random_number =  Math.floor(1000000000000000 + Math.random() * 9000000000000000).toString();
  const timestamp = (new Date()).getTime()
  const key = `${S3_DIR}/${timestamp}_${random_number}.xlsx`
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
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(`加配情報_${year}_${timestamp}.xlsx`)}"`,
  })
  return signed_url;
}