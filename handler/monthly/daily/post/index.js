const {response_ok, response_403} = require('lambda_response')
const {after_school, daily, instructor} = require('connect_dynamodb')
const { Auth } = require('Auth')

exports.handler = async (event, context) => {
  const decode_token = Auth.check_id_token(event)
  if(!decode_token){
      return response_403
  }

  const post_data = JSON.parse(event.body)

  const after_school_id = post_data.school_id
  const children = post_data.children.sum
  const disability = post_data.children.disability
  const medical_care = post_data.children.medical_care

  // POSTデータを整理
  const instructor_work_hours_tmp = post_data.instructors

  const after_school_info = await after_school.get_item(after_school_id)
  const open_type = after_school_info.Config.OpenTypes[post_data.open_type]
  const open  = post_data.open_type != '9' ? open_type.OpenTime : post_data.open_time.start
  const close = post_data.open_type != '9' ? open_type.CloseTime : post_data.open_time.end
  const instructor_work_hours =[]
  const open_instructor = {
    "Qualification": 0,
    "NonQualification": 0
  }
  const close_instructor = {
    "Qualification": 0,
    "NonQualification": 0
  }

  const instructor_info_tmp = {}
  for (const ins_id in instructor_work_hours_tmp){
    // 時間が入力されていない場合はスキップ
    if(instructor_work_hours_tmp[ins_id].start == '' || instructor_work_hours_tmp[ins_id].end == ''){
      continue
    }
    instructor_work_hours.push({
      "InstructorId": ins_id,
      "StartTime": instructor_work_hours_tmp[ins_id].start,
      "EndTime": instructor_work_hours_tmp[ins_id].end,
      "WorkHours": instructor_work_hours_tmp[ins_id].hours,
      "AdditionalCheck": instructor_work_hours_tmp[ins_id].additional_check,
    })
    const instructor_info = await instructor.get_item(after_school_id, ins_id)
    instructor_info_tmp[ins_id] = instructor_info
    // 開所・閉所時間の指導員数をカウント
    if (instructor_work_hours_tmp[ins_id]['start'] <= open.padStart(5, '0')){
      if (instructor_info.Qualification){
        open_instructor['Qualification'] += 1
      }else{
        open_instructor['NonQualification'] += 1
      }
    }
    if (instructor_work_hours_tmp[ins_id]['end'] >= close.padStart(5, '0')){
      if (instructor_info.Qualification){
        close_instructor['Qualification'] += 1
      }else{
        close_instructor['NonQualification'] += 1
      }
    }
  }

  // 指導員配置チェック
  const [ins_check, excess_shortage, work_member] = checkInstructor(instructor_work_hours, open, close, instructor_info_tmp)
  // 再登録する
  const response = await daily.put(
    after_school_id,
    post_data.date,
    post_data.open_type,
    {start: open, end: close},
    children,
    disability,
    medical_care,
    open_instructor,
    close_instructor,
    {
      "InstructorWorkHours": instructor_work_hours,
      "WorkMember": work_member,
      "Summary": {
        "WorkHours": post_data.summary.hours,
        "ExcessShortage": excess_shortage,
      }
    },
    ins_check,
  )
  console.log(response)
  return response_ok({});
};

// TODO: 過剰過少時間をチェックして保存しておく
// 結果をGETで返して表示する
function checkInstructor(instData, open, close, instructor_info_tmp) {
  // 開所・閉所時間から勤務ボックス作成
  let [open_h, open_m] = open.split(':').map((s) => parseInt(s))
  const work_member = {}
  while(true){
      const key = ('00' + String(open_h)).slice(-2) + ':' + ('00' + String(open_m)).slice(-2)
      if(key >= close){
          break
      }
      work_member[key] = {
          num: 0,
          qua: 0,
          add: 0,
          med: 0,
          shortage: {
            num: 0,
            qua: 0,
          },
          excess: {
            num: 0,
            qua: 0,
          }
      }
      open_m += 15
      if(open_m >= 60){
          open_h += 1
          open_m -= 60
      }
  }
  instData.map((value) => {
      if(value.WorkHours != ''){
          ins_info = instructor_info_tmp[value.InstructorId]
          Object.keys(work_member).forEach((key) => {
              if(value.StartTime <= key && key < value.EndTime){
                  if(!value.Additional){
                    work_member[key].num += 1
                  }
                  if(ins_info.Qualification && !value.Additional){
                      work_member[key].qua += 1
                  }
                  if(value.Additional){
                      work_member[key].add += 1
                  }
                  if(ins_info.MedicalCare){
                      work_member[key].med += 1
                  }
              }
          })
      }
  })

  /*
      配置をチェックする
          １．全時間帯で2人以上
          ２．全時間帯にquaが1人以上
          TODO: 加配の条件をどうするか
  */
  let check_response = true
  Object.keys(work_member).map((key) => {
    // ２人以上配置されているか
    if(work_member[key].num < 2){
      check_response = false
      work_member[key]['shortage']['num'] = 2 - work_member[key].num
    }else if(work_member[key].num > 2){
      work_member[key].excess.num = work_member[key].num - 2
    }
    // 資格者が1人以上配置されているか
    if(work_member[key].qua < 1){
      check_response = false
      work_member[key]['shortage']['qua'] = 1 - work_member[key].qua
    }else if(work_member[key].qua > 1){
      work_member[key].excess.qua = work_member[key].qua - 1
    }
  })
  const excess_shortage = {}
  Object.keys(work_member).map((key) => {
    if(work_member[key].shortage.num > 0 || work_member[key].shortage.qua > 0 ||
      work_member[key].excess.num > 0 || work_member[key].excess.qua > 0){
      excess_shortage[key] = {
        'shortage': {
          'num': work_member[key].shortage.num,
          'qua': work_member[key].shortage.qua,
        },
        'excess': {
          'num': work_member[key].excess.num,
          'qua': work_member[key].excess.qua,
        }
      }
    }
  })
  return [check_response, excess_shortage, work_member]
}