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

    const instructors = await instructor.get_all(pp.school_id)

    if(!instructors){
        return response_400
    }

    const response = {instructors: []}
    instructors.forEach(item => {
        // 削除フラグが立っている場合はスキップ
        response.instructors.push({
            id: item.SK.split('#')[1],
            name: item.Name,
            qualification: item.Qualification,
            additional: item.Additional,
            medical_care: item.MedicalCare,
            seiki: item.Seiki,
            koyou: item.Koyou,
            order: item.Order ? item.Order : 99,
            retirement_date: item.RetirementDate ? item.RetirementDate : null,
        })
    });

    return response_ok(response);
};