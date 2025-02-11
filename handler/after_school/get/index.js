const { response_ok, response_403 } = require('lambda_response')
const { user, after_school, instructor } = require('connect_dynamodb')
const { Auth } = require('Auth')

exports.handler = async (event, context) => {
    const decode_token = Auth.check_id_token(event)
    if(!decode_token){
        return response_403
    }

    const user_data = await user.get_item(decode_token['cognito:username'])

    const response = {
        list: []
    }
    const after_schools = await after_school.get_all()
    for (const school_info of after_schools){
        const school_id = school_info.SK.split('#')[1]
        const child_count = Object.values(school_info.Children).reduce((sum, value) => sum + parseInt(value), 0)
        const instructors = await instructor.get_all(school_id)
        // RetirementDateが設定されていないものだけをカウント
        if (user_data.AfterSchools.includes(school_id) || user_data.Admin){
            response.list.push({
                school_id: school_id,
                school_name: school_info.Name,
                open_types: school_info.Config.OpenTypes,
                child_count: child_count,
                instructor_count: instructors.filter(instructor => !instructor.RetirementDate).length,
            })
        }
    }

    return response_ok(response);
};