const fs = require('fs').promises;
var prompt = require('prompt-sync')();
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const express = require('express');
const app=express();
let mailId;
let replyTemplate;
let newLableflag;
let labelId;
// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}
const createRawMessage = (email) => {
    const utf8Bytes = Buffer.from(email, 'utf-8');
    const base64 = utf8Bytes.toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
/**
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function findLabels(auth) {
    const gmail = google.gmail({version: 'v1', auth});
    const res = await gmail.users.labels.list({
      userId: 'me',
    });
    const labels = res.data.labels;
    if (!labels || labels.length === 0) {
      console.log('No labels found.');
      return;
    }
    console.log('Labels:');
    let found = labels.find((label) => label.name===newLableflag); 
    console.log('Found');
    console.log(found);
    return found;
}



async function checkNewEmails(auth) {
    try {
      // Get list of unread messages
      const gmail = google.gmail({version: 'v1', auth});
      const response = await gmail.users.messages.list({
        userId: 'me',
        maxResults:1,
        q: 'is:unread' 
      });
  
      const messages = response.data.messages;
      console.log(messages.length);
      console.log(response.data.messages);
      
    //  Iterate through each message
      for (const message of messages) {
        const messageId = message.id;
        //Check if the email thread has prior replies
        const thread = await gmail.users.threads.get({
          userId: 'me',
          id: message.threadId,
          format: 'full'
        });
        const threadMessages = thread.data.messages;
        console.log(threadMessages[0].payload.headers);
        const hasPriorReplies = threadMessages.some((msg) => {
            const fromHeader = msg.payload.headers.filter((header) => header.name === 'From');
            const from = fromHeader ? fromHeader.value : null;
            return from && from !== mailId; // Perform null check before comparing addresses
          });
            
        if (!hasPriorReplies) {
            console.log('inside');
          // Send reply email
       
           const toRecipient= threadMessages[0].payload.headers.find((header) => header.name === 'From').value;
           const subject = threadMessages[0].payload.headers.find(header => header.name === 'Subject').value;
           const References= threadMessages[0].payload.headers.find(header =>header.name.toLowerCase() === 'message-id').value;
           const replyTo = threadMessages[0].payload.headers.find(header => header.name.toLowerCase() === 'message-id').value;
           console.log(toRecipient);
           const replyEmail = {
            to: toRecipient,
            subject: `Re: ${subject}`,
            body: replyTemplate,
            references: References,
            replyTo: replyTo
          };
        
          const rawMessage = `To: ${replyEmail.to}\r\n` +
                `Subject: ${replyEmail.subject}\r\n` +
                `In-Reply-To: ${replyEmail.replyTo}\r\n` + // Use the message ID of the original email
                `References: ${replyEmail.references}\r\n\r\n` + // Use the message ID of the original email
                `${replyEmail.body}`;

          const formattedRaw = createRawMessage(rawMessage);

          await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
              threadId: message.threadId,
              raw: formattedRaw // Replace with your desired reply content
            }
          });
       //   Add label to the email
          let foundLabel= await findLabels(auth);
          if(foundLabel===undefined) {
                const labelResponse = await gmail.users.labels.create({
                    userId: 'me',
                    requestBody: {
                    name: newLableflag // Replace with your desired label name
                    }
                });
                console.log(labelResponse.data);
                labelId= labelResponse.data.id;
            }
            else{
            labelId= foundLabel.id;
            }    
            console.log(labelId);
            await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                addLabelIds: [labelId],
                removeLabelIds: ['INBOX']
                }
            });

                await gmail.users.messages.modify({
                    userId: 'me',
                    id: messageId,
                    requestBody: {
                    addLabelIds: [labelId],
                    removeLabelIds: ['INBOX']
                    }
                });
            
          console.log('Reply sent and label added to email:', messageId);
     }
       }
    }
     catch (error) {
      console.error('Error occurred while checking new emails:', error);
    }
  }
  
async function start(){
    console.log('Application is Starting');
    // mailId = 'geerthana.cs19@bitsathy.ac.in';//prompt('Enter your email address for sending the reply : ');
    // replyTemplate='reply mail';//prompt('Enter your reply template : ');
    // newLableflag='demo';//prompt('Enter the LABLE name : ');
    mailId = prompt('Enter your email address for sending the reply : ');
    replyTemplate=prompt('Enter your reply template : ');
    newLableflag=prompt('Enter the LABLE name : ');
    await authorize().then(checkNewEmails).catch(console.error);
// Function to repeat the sequence of steps at random intervals
    // function repeatSequence() {
    //     const minInterval = 45000; // 45 seconds
    //     const maxInterval = 120000; // 120 seconds
    //     //const interval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
    //     const interval=5000;
    //     console.log(interval);
    //     setTimeout(async () => {
    //     try{
    //     await checkNewEmails();
    //     }
    //     catch(err){
    //         console.log(err);
    //         return;
    //     }
    //     repeatSequence();
    //     }, interval);
    // }
    // await authorize().then(repeatSequence).catch(console.error);
}
start();