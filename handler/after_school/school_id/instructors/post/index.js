const { response_ok, response_400, response_403 } = require('lambda_response')
const { instructor } = require('connect_dynamodb')
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

    // 指導員IDを自動採番する
    const instructor_id = await instructor.get_new_id(pp.school_id)

    const response = await instructor.put(
        pp.school_id,
        instructor_id,
        post_data.instructor_Name,
        post_data.qualification,
        post_data.additional,
        post_data.medical_care,
        post_data.seiki,
        post_data.koyou,
        post_data.order,
    )

    console.log(response)

    return response_ok({});
};