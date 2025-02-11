const { response_ok, response_400, response_403 } = require('lambda_response')
const { after_school } = require('connect_dynamodb')
const { Auth } = require('Auth')

exports.handler = async (event, context) => {
  const decode_token = Auth.check_id_token(event)
  if(!decode_token){
    return response_403
  }
  const pp = event.pathParameters
  if (!pp.school_id){
    return response_400
  }
  const post_data = JSON.parse(event.body)

  // 登録児童と開所時刻設定を取り出す
  const child_data = {c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, c6: 0,}
  const open_types = {
    '0': {OpenTime: '', CloseTime: ''},
    '1': {OpenTime: '', CloseTime: ''},
    '2': {OpenTime: '', CloseTime: ''},
    '3': {OpenTime: '', CloseTime: ''},
    '4': {OpenTime: '', CloseTime: ''},
  }

  Object.keys(post_data).forEach((key) => {
    if(key.startsWith('children_')){
      switch (key.slice(-1)) {
        case '1':
          child_data.c1 = post_data[key]
          break;
        case '2':
          child_data.c2 = post_data[key]
          break;
        case '3':
          child_data.c3 = post_data[key]
          break;
        case '4':
          child_data.c4 = post_data[key]
          break;
        case '5':
          child_data.c5 = post_data[key]
          break;
        case '6':
          child_data.c6 = post_data[key]
          break;
        default:
          break;
      }
    } else if(key.startsWith('open_time_')){
      const key_split = key.split('_')
      switch (key_split[3]) {
        case 'open':
          open_types[key_split[2]].OpenTime = post_data[key]
          break;
        case 'close':
          open_types[key_split[2]].CloseTime = post_data[key]
          break;
        default:
          break;
      }
    }
  })

  await after_school.put(
    pp.school_id,
    post_data.after_school_name,
    post_data.after_school_number,
    open_types,
    child_data
  )
  return response_ok({});
};
