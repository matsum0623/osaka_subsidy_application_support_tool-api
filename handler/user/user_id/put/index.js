const { response_ok, response_403 } = require('lambda_response')
const { user } = require('connect_dynamodb')
const { Auth } = require('Auth')

exports.handler = async (event, context) => {
    const decode_token = Auth.check_id_token(event)
    if(!decode_token){
        return response_403
    }

    const post_data = JSON.parse(event.body)
    const user_data = await user.get_item(decode_token['cognito:username'])

    // 管理者、または自分自身のみ編集が可能
    if(!user_data.Admin && post_data.user_id != user_data.SK.split('#')[1]){
        return response_403
    }
    // 管理者のみが管理者権限を付与できる
    const admin_flag = user_data.Admin ? post_data.admin_flag : false

    const response = await user.put(
        post_data.user_id,
        post_data.user_name,
        post_data.email,
        post_data.after_schools,
        admin_flag,
    )

    return response_ok(response);
};