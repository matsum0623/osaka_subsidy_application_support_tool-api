const { response_ok, response_403 } = require('lambda_response')
const { user } = require('connect_dynamodb')
const { Auth } = require('Auth')

const { CognitoIdentityProviderClient, AdminDeleteUserCommand } = require("@aws-sdk/client-cognito-identity-provider");

const cognitoClient = new CognitoIdentityProviderClient({ region: 'ap-northeast-1' });

exports.handler = async (event, context) => {
    const decode_token = Auth.check_id_token(event)
    if(!decode_token){
        return response_403
    }

    const pp = event.pathParameters
    if (!pp.user_id){
        return response_400
    }
    const request_user = await user.get_item(decode_token['cognito:username'])

    // 管理者のみユーザ削除が可能
    if(!request_user.Admin){
        return response_403
    }

    const deleteUserParams = {
        UserPoolId: process.env.USER_POOL_ID,
        Username: pp.user_id
    };

    try {
        await cognitoClient.send(new AdminDeleteUserCommand(deleteUserParams));
    } catch (error) {
        console.error('Error deleting user:', error);
        return response_403;
    }

    // DynamoDBのユーザ情報を削除
    const response = await user.delete(
        pp.user_id,
    )

    return response_ok(response);
};