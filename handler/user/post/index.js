const { response_ok, response_403 } = require('lambda_response')
const { user } = require('connect_dynamodb')
const { Auth } = require('Auth')

const { CognitoIdentityProviderClient, AdminCreateUserCommand } = require("@aws-sdk/client-cognito-identity-provider");

const cognitoClient = new CognitoIdentityProviderClient({ region: 'ap-northeast-1' });

exports.handler = async (event, context) => {
    const decode_token = Auth.check_id_token(event)
    if(!decode_token){
        return response_403
    }

    const post_data = JSON.parse(event.body)
    const request_user = await user.get_item(decode_token['cognito:username'])

    // 管理者のみユーザ追加が可能
    if(!request_user.Admin){
        return response_403
    }

    const createUserParams = {
        UserPoolId: process.env.USER_POOL_ID,
        Username: post_data.user_id,
        UserAttributes: [
            {
                Name: 'email',
                Value: post_data.email,
            },
            {
                Name: 'name',
                Value: post_data.user_name,
            },
        ],
    };

    try {
        await cognitoClient.send(new AdminCreateUserCommand(createUserParams));
    } catch (error) {
        console.error('Error creating user in Cognito:', error);
        return response_403;
    }

    const response = await user.put(
        post_data.user_id,
        post_data.user_name,
        post_data.email,
        post_data.after_schools,
        post_data.admin_flag,
    )

    return response_ok(response);
};