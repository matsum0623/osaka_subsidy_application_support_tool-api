const { response_ok, response_403 } = require('lambda_response')
const { user, after_school } = require('connect_dynamodb')
const { Auth } = require('Auth')

/**
 * ユーザ情報を取得するAPI
*/
exports.handler = async (event, context) => {
    const decode_token = Auth.check_id_token(event)
    if(!decode_token){
        return response_403
    }

    const pp = event.pathParameters
    if (!pp.user_id){
        return response_400
    }

    const request_user = await user.get_item(decode_token['cognito:username'])
    const user_data = await user.get_item(pp.user_id)

    // 管理者、または自分自身のみ取得が可能
    if(!request_user.Admin && pp.user_id != user_data.SK.split('#')[1]){
        return response_403
    }

    const response = {
        user_data: {
            user_name: user_data.UserName,
            email: user_data.Email,
            after_schools: user_data.AfterSchools
        }
    }
    // 管理者の場合には管理者かどうかのフラグも付与する
    if(request_user.Admin){
        response.user_data.admin = user_data.Admin
    }
    return response_ok(response);
};