const { response_ok, response_400, response_403 } = require('lambda_response')
const { after_school, instructor, app_const } = require('connect_dynamodb')
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

    if(pp.school_id == 'new'){
        // 新規作成時は開所時刻設定だけ返す。
        // TODO:開所タイプ返すだけだし、別で返してもいいような気がする
        const open_types = await app_const.get_open_types()
        const response = {
            school_id: '',
            school_name: '',
            open_types: [],
            instructor_num: 0,
            children: {c6:0, c5:0, c4:0, c3:0, c2:0, c1:0},
        }
        Object.keys(open_types).forEach((id) => {
            response.open_types.push({
                type_id: id,
                type_name: open_types[id].TypeName,
                open_time: open_types[id].DefaultOpenTime,
                close_time: open_types[id].DefaultCloseTime,
            })
        })
        return response_ok(response)
    }

    const school_info = await after_school.get_item(pp.school_id)
    if(!school_info){
        return response_400
    }
    const instructors = await instructor.get_all(pp.school_id)
    const open_types = await app_const.get_open_types()

    const response = {
        school_id: pp.school_id,
        school_name: school_info.Name,
        school_number: school_info.Number,
        open_types: [
        ],
        instructor_num: instructors.filter(instructor => !instructor.RetirementDate).length,
        children: school_info.Children,
    }
    for(const id in school_info.Config.OpenTypes){
        response.open_types.push({
            type_id: id,
            type_name: id in Object.keys(open_types) ? open_types[id].TypeName : '',
            open_time: school_info.Config.OpenTypes[id].OpenTime,
            close_time: school_info.Config.OpenTypes[id].CloseTime,
        })
    }

    return response_ok(response);
};