const fs = require('fs');
const AWS = require("aws-sdk");
const s3 = new AWS.S3();

const { response_ok, response_403, response_400 } = require('lambda_response')
const { after_school, daily, instructor } = require('connect_dynamodb')
const { Auth } = require('Auth')

const XlsxPopulate = require('xlsx-populate');

exports.handler = async (event, context) => {
  const decode_token = Auth.check_id_token(event)
  if(!decode_token){
      return response_403
  }

  const qsp = event.queryStringParameters
  if(qsp == undefined || !qsp.ym || !qsp.school_id){
    return response_403
  }

  const ym = qsp.ym
  const after_school_id = qsp.school_id

  // 出力タイプ（勤務表ダウンロード時はtyp=work_schedule)
  const output_type = qsp.type || 'monthly_report'

  if(output_type == 'monthly_report'){
    // 月次報告書ダウンロード
    return await output_monthly_report(after_school_id, ym)
  } else if(output_type == 'work_schedule') {
    // 勤務表ダウンロード
    return await output_work_schedule(after_school_id, ym)
  } else {
    return response_400
  }
};

const get_daily_dict = async (after_school_id, ym) => {
  const daily_dict = {}
  try {
      const result = await daily.get_list(after_school_id, ym)
      // 結果を日付をキーにしたオブジェクトに変換
      result.forEach(item => {
          daily_dict[item.SK.slice(-10)] = item
      });
  } catch (error) {
      console.log(error.message)
  }
  return daily_dict
}

const upload_file_and_get_url = async (dir, file_name) => {
  const random_number = Math.floor(1000000000000000 + Math.random() * 9000000000000000).toString();

  const key = `${dir}/${random_number}.xlsx`
  try {
    await s3.putObject({
      Bucket: process.env.FILE_DOWNLOAD_BUCKET_NAME,
      Key: key,
      Body: fs.createReadStream('/tmp/Output.xlsx'),
    }).promise();
  } catch (error) {
    console.log(error)
  }
  return await s3.getSignedUrl('getObject', {
    Bucket: process.env.FILE_DOWNLOAD_BUCKET_NAME,
    Key: key,
    Expires: 60,
    ResponseContentDisposition: `attachment; filename="${encodeURIComponent(file_name)}"`
  })
}

const input_cell = (sheet, cell, val, type='text') => {
  if(type == 'text'){
    sheet.cell(cell).value(val)
  }else if(type == 'number'){
    const num = val == '' ? '' : parseInt(val)
    sheet.cell(cell).value(num)
  }
}

const output_monthly_report = async (after_school_id, ym) => {
  const start_month_date = new Date(ym + '-01')
  const year = start_month_date.getFullYear()
  const month = start_month_date.getMonth() + 1

  const daily_dict = await get_daily_dict(after_school_id, ym)

  const instructors = {}
  const all_instructors = await instructor.get_all(after_school_id)
  const after_school_info = await after_school.get_item(after_school_id)

  const seiki_dict = {
    '1': '正規',
    '2': '非正規',
  }
  const koyou_dict = {
    '1': '常勤',
    '2': '非常勤(みなし常勤)',
    '3': '非常勤',
  }

  const instructor_types = {
    '1': {
      '1': 0,
      '2': 0,
      '3': 0,
    },
    '2': {
      '1': 0,
      '2': 0,
      '3': 0,
    },
    '3': {
      '1': 0,
      '2': 0,
      '3': 0,
    },
  }

  console.log('start create Excel')
  const book = await XlsxPopulate.fromFileAsync("./template/template.xlsx")

  console.log('open Excel done')

  console.log('start input instructor sheet')
  // 職員一覧記載
  const instructor_sheet = book.sheet("職員一覧")
  let row_idx = 2
  all_instructors.forEach((value) => {
    if(value.RetirementDate < ym + '-01') return
    instructors[value['SK'].split('#')[1]] = value['Name']
    input_cell(instructor_sheet, "B" + row_idx, value['Name'], 'text')
    input_cell(instructor_sheet, "C" + row_idx, value.Qualification ? '放課後児童支援員' : '補助員', 'text')
    input_cell(instructor_sheet, "D" + row_idx, seiki_dict[value.Seiki] + '・' + koyou_dict[value.Koyou], 'text')

    instructor_types[value.Koyou][value.Qualification ? '1': '2'] += 1
    row_idx++;
  })

  console.log('start input month sheet1')
  // 報告書１記載
  const month_sheet_1 = book.sheet("月次報告書１")
  month_sheet_1.cell("M1").value(year - 2018)    // 年（令和）
  month_sheet_1.cell("O1").value(month)   // 月
  month_sheet_1.cell("O4").value(after_school_info.Number)    // 事業所番号
  month_sheet_1.cell("Q4").value(after_school_info.Name)    // 児童クラブ名

  let dt = start_month_date
  const open_type_count = {
    '0': 0,
    '1': 0,
    '2': 0,
    '3': 0,
    '4': 0,
    '9': 0,   // 日曜加算の時刻変動型
  }
  while (dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) == ym) {
    const dt_str = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2)
    if(dt_str in daily_dict) {
      const row = (dt.getDate() + 10)
      input_cell(month_sheet_1, "C" + row, daily_dict[dt_str].Children, 'number')
      input_cell(month_sheet_1, "D" + row, daily_dict[dt_str].Disability, 'number')
      input_cell(month_sheet_1, "E" + row, daily_dict[dt_str].MedicalCare, 'number')
      input_cell(month_sheet_1, "F" + row, daily_dict[dt_str].OpenInstructor.Qualification, 'number')
      input_cell(month_sheet_1, "G" + row, daily_dict[dt_str].OpenInstructor.NonQualification, 'number')
      input_cell(month_sheet_1, "H" + row, daily_dict[dt_str].CloseInstructor.Qualification, 'number')
      input_cell(month_sheet_1, "I" + row, daily_dict[dt_str].CloseInstructor.NonQualification, 'number')

      const ob = daily_dict[dt_str]['Details']['InstructorWorkHours']
      const instructor_cols = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']
      let col_idx = 0
      ob.sort((a, b) => {a.InstructorId > b.InstructorId}).forEach((inst_work_info) => {
        input_cell(month_sheet_1, instructor_cols[col_idx] + row, instructors[inst_work_info.InstructorId], 'text')
        col_idx++;
      })
      if (daily_dict[dt_str].OpenType != undefined && daily_dict[dt_str].Children > 0) {
        open_type_count[daily_dict[dt_str].OpenType] += 1
      }
    }
    dt = new Date(dt.setDate(dt.getDate() + 1));
  }

  console.log('start input month sheet2')
  // 報告書２記載
  const month_sheet_2 = book.sheet("月次報告書２")
  input_cell(month_sheet_2, "F10", open_type_count['0'], 'number')
  input_cell(month_sheet_2, "F11", open_type_count['1'], 'number')
  input_cell(month_sheet_2, "F12", open_type_count['2'], 'number')
  input_cell(month_sheet_2, "F13", open_type_count['3'], 'number')
  input_cell(month_sheet_2, "F14", open_type_count['4'] + open_type_count['9'], 'number')

  input_cell(month_sheet_2, "M10", after_school_info.Children.c6, 'number')
  input_cell(month_sheet_2, "O10", after_school_info.Children.c6, 'number')
  input_cell(month_sheet_2, "M11", after_school_info.Children.c5, 'number')
  input_cell(month_sheet_2, "O11", after_school_info.Children.c5, 'number')
  input_cell(month_sheet_2, "M12", after_school_info.Children.c4, 'number')
  input_cell(month_sheet_2, "O12", after_school_info.Children.c4, 'number')
  input_cell(month_sheet_2, "M13", after_school_info.Children.c3, 'number')
  input_cell(month_sheet_2, "O13", after_school_info.Children.c3, 'number')
  input_cell(month_sheet_2, "M14", after_school_info.Children.c2, 'number')
  input_cell(month_sheet_2, "O14", after_school_info.Children.c2, 'number')
  input_cell(month_sheet_2, "M15", after_school_info.Children.c1, 'number')
  input_cell(month_sheet_2, "O15", after_school_info.Children.c1, 'number')

  input_cell(month_sheet_2, "D21", instructor_types['1']['1'], 'number')
  input_cell(month_sheet_2, "F21", instructor_types['1']['2'], 'number')
  input_cell(month_sheet_2, "FJ1", instructor_types['1']['3'], 'number')

  input_cell(month_sheet_2, "D22", instructor_types['2']['1'] + instructor_types['3']['1'], 'number')
  input_cell(month_sheet_2, "F22", instructor_types['2']['2'] + instructor_types['3']['2'], 'number')
  input_cell(month_sheet_2, "FJ2", instructor_types['2']['3'] + instructor_types['3']['3'], 'number')

  input_cell(month_sheet_2, "L46", instructor_types['1']['1'] + instructor_types['2']['1'] > 1 ? '２名以上雇用している' : '２名雇用していない', 'text')

  console.log('output Excel')
  await book.toFileAsync("/tmp/Output.xlsx")
  console.log('output Excel done')

  const url = await upload_file_and_get_url('monthly', `【${after_school_info.Number}】月次報告（令和${year - 2018}年${month}月分）.xlsx`)

  return response_ok({url: url})
}

const output_work_schedule = async (after_school_id, ym) => {
  const start_month_date = new Date(ym + '-01')
  const year = start_month_date.getFullYear()
  const month = start_month_date.getMonth() + 1

  const daily_dict = await get_daily_dict(after_school_id, ym)

  const all_instructors = await instructor.get_all(after_school_id)

  // 指導員ごとにループ
  console.log('start create Excel')
  const book = await XlsxPopulate.fromFileAsync("./template/template_work_schedule.xlsx")
  console.log('open Excel done')

  // 勤務表作成
  const sheet = book.sheet("template")
  sheet.cell("C1").value(`${year}-${month}-01`)
  // TODO: 日付のStyleが変

  const instructor_id_index = {}
  let instructor_count = -1
  all_instructors.sort((a, b) => (a.Order - b.Order)).forEach((value) => {
    if(value.RetirementDate < ym + '-01') return
    // 名前を入れていく
    instructor_count++
    const instructor_name = value['Name']
    sheet.cell(`A${instructor_count * 3 + 4}`).value(instructor_name)
    instructor_id_index[value['SK'].split('#')[1]] = instructor_count
  })
  // 使わない行を非表示にする
  for(let i = instructor_count * 3 + 4; i < 49; i++){
    sheet.row(i).hidden(true)
  }

  const daily_col = [
    'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q',
    'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH'
  ]

  let dt = start_month_date
  let col_ct = 0
  while (dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) == ym) {
    const dt_str = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2)
    if(dt_str in daily_dict) {
      const col = daily_col[col_ct]
      daily_dict[dt_str]['Details']['InstructorWorkHours'].forEach((inst_work_info) => {
        const row = instructor_id_index[inst_work_info.InstructorId] * 3 + 4
        input_cell(sheet, col + row, inst_work_info.StartTime || '', 'text')
        input_cell(sheet, col + (row + 1), inst_work_info.EndTime || '', 'text')
        // 加配対象の場合はセル色を変える
        if(inst_work_info.AdditionalCheck){
          sheet.range(`${col}${row}:${col}${row + 2}`).style({fill: {type: 'solid', color: 'CAEDFB'}})
        }
      })
    }
    col_ct++
    dt = new Date(dt.setDate(dt.getDate() + 1));
  }

  // シート名の変更
  sheet.name(year + '年' + month + '月')

  console.log('output Excel')
  await book.toFileAsync("/tmp/Output.xlsx")
  console.log('output Excel done')

  const url = await upload_file_and_get_url('work_schedule', `勤務表${year}年${month}月.xlsx`)

  return response_ok({url: url})
}