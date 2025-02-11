const { response_ok, response_403 } = require('lambda_response')
const { user, after_school } = require('connect_dynamodb')
const { Auth } = require('Auth')

exports.handler = async (event, context) => {
    const decode_token = Auth.check_id_token(event)
    if(!decode_token){
        return response_403
    }
    const users_data = await user.get_all()
    const response = {
        list: []
    }
    users_data.forEach((user) => {
        response.list.push({
            user_id: user.SK.split('#')[1],
            user_name: user.UserName,
            email: user.Email,
            admin: user.Admin,
            after_schools: user.AfterSchools,
        })
    });
    return response_ok(response);
};