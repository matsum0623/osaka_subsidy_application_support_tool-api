const { response_ok, response_400, response_403 } = require('lambda_response')
const { holidays } = require('connect_dynamodb')
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

    const response = await holidays.put(
        pp.school_id,
        post_data.year,
        post_data.holidays,
    )

    console.log(response)

    return response_ok({});
};