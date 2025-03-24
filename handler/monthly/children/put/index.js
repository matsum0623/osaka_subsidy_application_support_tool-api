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
    if(daily_item){
      // 児童数のみ書き換えて登録
      const open_type = after_school_info.Config.OpenTypes[data.open_type]
      const open  = post_data.open_type != '9' ? open_type.OpenTime : undefined
      const close = post_data.open_type != '9' ? open_type.CloseTime : undefined
      await daily.put(
        after_school_id,
        date,
        data[date]['open_typ'],
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
        data[date]['open_typ'],
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
