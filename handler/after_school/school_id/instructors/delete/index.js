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

    // いったん指導員情報を取得
    const instructor_info = await instructor.get_item(
        pp.school_id,
        post_data.instructor_id,
    )
    // 削除フラグを立てて再登録
    await instructor.put(
        pp.school_id,
        post_data.instructor_id,
        instructor_info.Name,
        instructor_info.Qualification,
        instructor_info.Additional,
        instructor_info.MedicalCare,
        instructor_info.Seiki,
        instructor_info.Koyou,
        instructor_info.Order,
        post_data.retirement_date,
    )

    return response_ok({});
};