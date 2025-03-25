const {response_ok, response_403} = require('lambda_response')
const {after_school, daily} = require('connect_dynamodb')
const { Auth } = require('Auth')

exports.handler = async (event, context) => {
  const decode_token = Auth.check_id_token(event)
  if(!decode_token){
      return response_403
  }

  const post_data = JSON.parse(event.body)
  const after_school_id = post_data.school_id
  const data = post_data.data

  const after_school_info = await after_school.get_item(after_school_id)

  for(const date in data){
    // 登録があるかどうかチェック
    const daily_item = await daily.get_item(after_school_id, date)
    const open_type = after_school_info.Config.OpenTypes[String(data[date]['open_type'])]
    const open  = String(data[date]['open_type']) != '9' ? open_type.OpenTime : '6:00'
    const close = String(data[date]['open_type']) != '9' ? open_type.CloseTime : '22:00'
    if(daily_item && Object.keys(daily_item).length > 0){
      // 児童数のみ書き換えて登録
      await daily.put(
        after_school_id,
        date,
        data[date]['open_type'],
        {start: open, end: close},
        data[date]['children'],
        data[date]['disability'],
        data[date]['medical_care'],
        daily_item.OpenInstructor,
        daily_item.CloseInstructor,
        daily_item.Details,
        daily_item.InstructorCheck
      )
    }else{
      // 登録がなければ児童数と開所タイプのみ登録しておく
      await daily.put(
        after_school_id,
        date,
        data[date]['open_type'],
        {start: open, end: close},
        data[date]['children'],
        data[date]['disability'],
        data[date]['medical_care'],
        {"Qualification": 0, "NonQualification": 0},
        {"Qualification": 0, "NonQualification": 0},
        {
          "InstructorWorkHours": [],
          "WorkMember": {},
          "Summary": {
            "WorkHours": "",
            "ExcessShortage": {},
          }
        },
        false
      )
    }
  }

  return response_ok({});
};
