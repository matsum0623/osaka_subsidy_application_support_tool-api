const { daily, instructor } = require('connect_dynamodb')

exports.handler = async (event, context) => {
  const decode_token = Auth.check_id_token(event)
  if(!decode_token){
    return response_403
  }

  const qsp = event.queryStringParameters
  if(qsp == undefined || !qsp.year || !qsp.school_id){
    return response_403
  }

  const schoolId = qsp.school_id;
  const year = qsp.year;
  const month = 4;  // TODO: 開始月度を指定できるように
  const closingDate = 15; // TODO: 締め日の設定ができるようにする。学童設定あたりに保持しておく

  let additionalInstructors = await getAdditionalInstructors(schoolId);

  for (let i = 0; i < 12; i++) {
      let calcMonth = month + i;
      let calcYear = year;

      if (calcMonth > 12) {
          calcYear += 1;
          calcMonth -= 12;
      }

      const ym = `${calcYear.toString().padStart(4, '0')}-${calcMonth.toString().padStart(2, '0')}`;
      const prevMonth = calcMonth === 1 ? 12 : calcMonth - 1;
      const prevYear = calcMonth === 1 ? calcYear - 1 : calcYear;

      const startDate = `${prevYear.toString().padStart(4, '0')}-${prevMonth.toString().padStart(2, '0')}-${(closingDate + 1).toString().padStart(2, '0')}`;
      const endDate = `${calcYear.toString().padStart(4, '0')}-${calcMonth.toString().padStart(2, '0')}-${closingDate.toString().padStart(2, '0')}`;

      console.log(startDate, endDate);

      additionalInstructors = await calcMonthWorkSummary(schoolId, startDate, endDate, additionalInstructors, ym);
  }

  for (const workHours of Object.values(additionalInstructors)) {
      const totalHours = [];
      const workHoursWithinOpeningHours = [];
      const additionalHours = [];

      for (const hours of Object.values(workHours.WorkHours)) {
          totalHours.push(hours.TotalHours);
          workHoursWithinOpeningHours.push(hours.WorkHoursWithinOpeningHours);
          additionalHours.push(hours.AdditionalHours);
      }

      console.log(workHours.InstructorName);
      console.log(totalHours.map(convertIntToTime).join('\t'));
      console.log(additionalHours.map(convertIntToTime).join('\t'));
      console.log(workHoursWithinOpeningHours.map(convertIntToTime).join('\t'));
  }

}

async function getAdditionalInstructors(after_school_id) {
    const instructors = await instructor.get_additional(after_school_id)
    const additionalInstructors = {};
    instructors.forEach(item => {
        const instructorId = item.SK.split('#')[1];
        additionalInstructors[instructorId] = {
            InstructorName: item.Name,
            WorkHours: {}
        };
    });

    return additionalInstructors;
}

function convertTimeToInt(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours + minutes / 60;
}

function convertIntToTime(intTime) {
    const hour = Math.floor(intTime);
    const minute = Math.round((intTime - hour) * 60);
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

async function calcMonthWorkSummary(schoolId, startDate, endDate, additionalInstructors, ym) {
    const daily_data = await daily.get_list_between(schoolId, startDate, endDate);

    for (const inst in additionalInstructors) {
        additionalInstructors[inst].WorkHours[ym] = {
            TotalHours: 0,
            WorkHoursWithinOpeningHours: 0,
            AdditionalHours: 0,
        };
    }

    daily_data.forEach(item => {
        try {
            const open = convertTimeToInt(item.OpenTime.start);
            const close = convertTimeToInt(item.OpenTime.end);

            item.Details.InstructorWorkHours.forEach(workHour => {
                const instructorId = workHour.InstructorId;
                if (additionalInstructors[instructorId]) {
                    const instStart = convertTimeToInt(workHour.StartTime);
                    const instEnd = convertTimeToInt(workHour.EndTime);

                    additionalInstructors[instructorId].WorkHours[ym].TotalHours += instEnd - instStart;

                    if (workHour.AdditionalCheck) {
                        additionalInstructors[instructorId].WorkHours[ym].AdditionalHours += instEnd - instStart;
                    } else {
                        additionalInstructors[instructorId].WorkHours[ym].WorkHoursWithinOpeningHours += Math.min(close, instEnd) - Math.max(open, instStart);
                    }
                }
            });
        } catch (error) {
            console.error(item);
            throw error;
        }
    });

    return additionalInstructors;
}
