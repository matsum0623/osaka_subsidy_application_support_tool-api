const { response_ok, response_403 } = require('lambda_response')
const { after_school, daily, user, app_const, instructor, holidays } = require('connect_dynamodb')
const { Auth } = require('Auth')

exports.handler = async (event, context) => {
    const decode_token = Auth.check_id_token(event)
    if(!decode_token){
        return response_403
    }

    const today = new Date()
    const qsp = event.queryStringParameters
    if(qsp == undefined || !qsp.ym || !qsp.school_id){
        return response_403
    }
    const ym = !qsp.ym ? today.getFullYear() + '-' + ('0' + (today.getMonth() + 1)).slice(-2) : qsp.ym
    const after_school_id = qsp.school_id

    const daily_dict = {}
    try {
        const result = await daily.get_list(after_school_id, ym)
        // 結果を日付をキーにしたオブジェクトに変換
        result.forEach(item => {
            daily_dict[item.SK.slice(-10)] = item
        });
    } catch (error) {
        console.log(error.message)
    }

    const start_date = new Date(ym + '-01')
    let dt = start_date
    const res_list = []
    const instructors = {}
    const all_instructors = await instructor.get_all(after_school_id)
    all_instructors.forEach((value) => {
        instructors[value['SK'].split('#')[1]] = value['Name']
    })
    const holidays_res = await holidays.get_item(after_school_id, ym.split('-')[0])

    while (dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) == ym) {
        const dt_str = dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2)
        daily_list = [
            dt_str,
            dt.getDate().toString() + '日',
            dt.getDay(),
            dt_str in daily_dict ? daily_dict[dt_str]['OpenType'] : "",                                 // 開所タイプ
            dt_str in daily_dict ? daily_dict[dt_str]['Children'] : "",                                 // 児童数
            dt_str in daily_dict ? daily_dict[dt_str]['Disability'] : "",                               // 障がい児童数
            dt_str in daily_dict ? daily_dict[dt_str]['MedicalCare'] : "",                              // 医療的ケア児童数
            dt_str in daily_dict ? daily_dict[dt_str]['OpenInstructor']['Qualification'] : "",          // 開所時放課後児童支援員数
            dt_str in daily_dict ? daily_dict[dt_str]['OpenInstructor']['NonQualification'] : "",       // 開所時補助員数
            dt_str in daily_dict ? daily_dict[dt_str]['CloseInstructor']['Qualification'] : "",         // 閉所時放課後児童支援員数
            dt_str in daily_dict ? daily_dict[dt_str]['CloseInstructor']['NonQualification'] : "",      // 閉所時補助員数
            dt_str in daily_dict ? daily_dict[dt_str]['InstructorCheck'] : "",                          // 指導員配置チェック
            false,                                                                                      // 加配対象職員配置
            0,                                                                                          // 加配対象時間数
        ]
        // 加配退所職員チェック
        if(dt_str in daily_dict){
            daily_dict[dt_str].Details.InstructorWorkHours.forEach((ins) => {
                if(ins.AdditionalCheck){
                    daily_list[12] = true
                    daily_list[13] += convertTimeToInt(ins.EndTime) - convertTimeToInt(ins.StartTime)
                }
            })
        }
        res_list.push(daily_list)
        dt = new Date(dt.setDate(dt.getDate() + 1));
    }

    const after_school_info = await after_school.get_item(after_school_id)
    const open_types = await app_const.get_open_types()
    open_types_res = {}
    Object.keys(after_school_info['Config']['OpenTypes']).forEach((key) => {
    open_types_res[key] = {
        OpenTime: after_school_info['Config']['OpenTypes'][key].OpenTime,
        CloseTime: after_school_info['Config']['OpenTypes'][key].CloseTime,
        TypeName: key in Object.keys(open_types) ? open_types[key].TypeName : '',
    }
    })

    const user_data = await user.get_item(decode_token['cognito:username'])
    return response_ok({
        list: res_list,
        holidays: holidays_res.Holidays,
        config: {
            open_types: open_types_res
        },
        user_data: {
            user_name: user_data.UserName,
            admin: user_data.Admin,
        }
    });
};

function convertTimeToInt(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours + minutes / 60;
}
