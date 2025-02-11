const { response_ok, response_403 } = require('lambda_response')
const { user, after_school } = require('connect_dynamodb')
const { Auth } = require('Auth')

/**
 * 自分自身のユーザ情報を取得するAPI
*/
exports.handler = async (event, context) => {
    console.log(event)
    const decode_token = Auth.check_id_token(event)
    if(!decode_token){
        return response_403
    }

    const user_data = await user.get_item(decode_token['cognito:username'])
    const response = {
        user_data: {
            user_name: user_data.UserName,
            email: user_data.Email,
            admin: user_data.Admin,
            after_schools: []
        }
    }
    for (const school_id of user_data.AfterSchools){
        const af = await after_school.get_item(school_id)
        response.user_data.after_schools.push({
            school_id: school_id,
            school_name: af.Name,
        })
    }
    return response_ok(response);
};