'use strict';

const apiai = require('apiai');
const express = require('express');
const bodyParser = require('body-parser');
const uuid = require('uuid');
const request = require('request');
const JSONbig = require('json-bigint');
const async = require('async');


const REST_PORT = (process.env.PORT || 5000);
const APIAI_ACCESS_TOKEN = process.env.APIAI_ACCESS_TOKEN;
const APIAI_LANG = process.env.APIAI_LANG || 'en';
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN;
const FB_PAGE_ACCESS_TOKEN = process.env.FB_PAGE_ACCESS_TOKEN;
const FB_TEXT_LIMIT = 640;
const CUSTOMER_ONBOARDED_URL = 'http://paygatetest.fidelitybank.ng/cbanking/api/conversebanking/enrollcustomer';
const TRANSFER_URL = 'http://paygatetest.fidelitybank.ng/cbanking/api/conversebanking/transfer';
const CHECK_BALANCE_URL = 'http://paygatetest.fidelitybank.ng/cbanking/api/conversebanking/balanceenquiry';
const APP_URL = 'https://myfidelity2.herokuapp.com';

const FACEBOOK_LOCATION = "FACEBOOK_LOCATION";
const FACEBOOK_WELCOME = "FACEBOOK_WELCOME";

let facebookId = '';
let destAccount = '';
let bvn = '';
let pin = '';
let amount = '';
let accountNumber = '';
let senderId = "";

class FacebookBot {
    constructor() {
        this.apiAiService = apiai(APIAI_ACCESS_TOKEN, { language: APIAI_LANG, requestSource: "fb" });
        this.sessionIds = new Map();
        this.messagesDelay = 200;
    }


    doDataResponse(sender, facebookResponseData) {
        if (!Array.isArray(facebookResponseData)) {
            console.log('Response as formatted message');
            this.sendFBMessage(sender, facebookResponseData)
                .catch(err => console.error(err));
        } else {
            async.eachSeries(facebookResponseData, (facebookMessage, callback) => {
                if (facebookMessage.sender_action) {
                    console.log('Response as sender action');
                    this.sendFBSenderAction(sender, facebookMessage.sender_action)
                        .then(() => callback())
                        .catch(err => callback(err));
                } else {
                    console.log('Response as formatted message');
                    this.sendFBMessage(sender, facebookMessage)
                        .then(() => callback())
                        .catch(err => callback(err));
                }
            }, (err) => {
                if (err) {
                    console.error(err);
                } else {
                    console.log('Data response completed');
                }
            });
        }
    }

    doRichContentResponse(sender, messages) {
        let facebookMessages = []; // array with result messages

        for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
            let message = messages[messageIndex];

            switch (message.type) {
                //message.type 0 means text message
                case 0:
                    // speech: ["hi"]
                    // we have to get value from fulfillment.speech, because of here is raw speech
                    if (message.speech) {

                        let splittedText = this.splitResponse(message.speech);

                        splittedText.forEach(s => {
                            facebookMessages.push({ text: s });
                        });
                    }

                    break;
                    //message.type 1 means card message
                case 1:
                    {
                        let carousel = [message];

                        for (messageIndex++; messageIndex < messages.length; messageIndex++) {
                            if (messages[messageIndex].type == 1) {
                                carousel.push(messages[messageIndex]);
                            } else {
                                messageIndex--;
                                break;
                            }
                        }

                        let facebookMessage = {};
                        carousel.forEach((c) => {
                            // buttons: [ {text: "hi", postback: "postback"} ], imageUrl: "", title: "", subtitle: ""

                            let card = {};

                            card.title = c.title;
                            card.image_url = c.imageUrl;
                            if (this.isDefined(c.subtitle)) {
                                card.subtitle = c.subtitle;
                            }
                            //If button is involved in.
                            if (c.buttons.length > 0) {
                                let buttons = [];
                                for (let buttonIndex = 0; buttonIndex < c.buttons.length; buttonIndex++) {
                                    let button = c.buttons[buttonIndex];

                                    if (button.text) {
                                        let postback = button.postback;
                                        if (!postback) {
                                            postback = button.text;
                                        }

                                        let buttonDescription = {
                                            title: button.text
                                        };

                                        if (postback.startsWith("http")) {
                                            buttonDescription.type = "web_url";
                                            buttonDescription.url = postback;
                                        } else {
                                            buttonDescription.type = "postback";
                                            buttonDescription.payload = postback;
                                        }

                                        buttons.push(buttonDescription);
                                    }
                                }

                                if (buttons.length > 0) {
                                    card.buttons = buttons;
                                }
                            }

                            if (!facebookMessage.attachment) {
                                facebookMessage.attachment = { type: "template" };
                            }

                            if (!facebookMessage.attachment.payload) {
                                facebookMessage.attachment.payload = { template_type: "generic", elements: [] };
                            }

                            facebookMessage.attachment.payload.elements.push(card);
                        });

                        facebookMessages.push(facebookMessage);
                    }

                    break;
                    //message.type 2 means quick replies message
                case 2:
                    {
                        if (message.replies && message.replies.length > 0) {
                            let facebookMessage = {};

                            facebookMessage.text = message.title ? message.title : 'Choose an item';
                            facebookMessage.quick_replies = [];

                            message.replies.forEach((r) => {
                                facebookMessage.quick_replies.push({
                                    content_type: "text",
                                    title: r,
                                    payload: r
                                });
                            });

                            facebookMessages.push(facebookMessage);
                        }
                    }

                    break;
                    //message.type 3 means image message
                case 3:

                    if (message.imageUrl) {
                        let facebookMessage = {};

                        // "imageUrl": "http://example.com/image.jpg"
                        facebookMessage.attachment = { type: "image" };
                        facebookMessage.attachment.payload = { url: message.imageUrl };

                        facebookMessages.push(facebookMessage);
                    }

                    break;
                    //message.type 4 means custom payload message
                case 4:
                    if (message.payload && message.payload.facebook) {
                        facebookMessages.push(message.payload.facebook);
                    }
                    break;

                default:
                    break;
            }
        }

        return new Promise((resolve, reject) => {
            async.eachSeries(facebookMessages, (msg, callback) => {
                    this.sendFBSenderAction(sender, "typing_on")
                        .then(() => this.sleep(this.messagesDelay))
                        .then(() => this.sendFBMessage(sender, msg))
                        .then(() => callback())
                        .catch(callback);
                },
                (err) => {
                    if (err) {
                        console.error(err);
                        reject(err);
                    } else {
                        console.log('Messages sent');
                        resolve();
                    }
                });
        });

    }

    doTextResponse(sender, responseText) {
        console.log('Response as text message');
        // facebook API limit for text length is 640,
        // so we must split message if needed
        let splittedText = this.splitResponse(responseText);

        async.eachSeries(splittedText, (textPart, callback) => {
            this.sendFBMessage(sender, { text: textPart })
                .then(() => callback())
                .catch(err => callback(err));
        });
    }

    //which webhook event
    getEventText(event) {
        if (event.message) {
            if (event.message.quick_reply && event.message.quick_reply.payload) {
                return event.message.quick_reply.payload;
            }

            if (event.message.text) {
                return event.message.text;
            }
        }

        if (event.postback && event.postback.payload) {
            return event.postback.payload;
        }

        return null;

    }

    getFacebookEvent(event) {
        if (event.postback && event.postback.payload) {

            let payload = event.postback.payload;

            switch (payload) {
                case FACEBOOK_WELCOME:
                    return { name: FACEBOOK_WELCOME };

                case FACEBOOK_LOCATION:
                    return { name: FACEBOOK_LOCATION, data: event.postback.data }
            }
        }

        return null;
    }

    processFacebookEvent(event) {
        const sender = event.sender.id.toString();

        const eventObject = this.getFacebookEvent(event);

        if (eventObject) {

            // Handle a text message from this sender
            if (!this.sessionIds.has(sender)) {
                this.sessionIds.set(sender, uuid.v4());
            }

            let apiaiRequest = this.apiAiService.eventRequest(eventObject, {
                sessionId: this.sessionIds.get(sender),
                originalRequest: {
                    data: event,
                    source: "facebook"
                }
            });
            this.doApiAiRequest(apiaiRequest, sender);
        }
    }

    processMessageEvent(event) {
        const sender = event.sender.id.toString();

        const text = this.getEventText(event);

        if (text) {

            // Handle a text message from this sender
            if (!this.sessionIds.has(sender)) {
                this.sessionIds.set(sender, uuid.v4());
            }

            console.log("Text", text);
            //send user's text to api.ai service
            let apiaiRequest = this.apiAiService.textRequest(text, {
                sessionId: this.sessionIds.get(sender),
                originalRequest: {
                    data: event,
                    source: "facebook"
                }
            });



            this.doApiAiRequest(apiaiRequest, sender);
        }
    }

    doApiAiRequest(apiaiRequest, sender) {
        apiaiRequest.on('response', (response) => {

            if (this.isDefined(response.result) && this.isDefined(response.result.fulfillment)) {

                let responseText = response.result.fulfillment.speech;
                let responseData = response.result.fulfillment.data;
                let responseMessages = response.result.fulfillment.messages;
                let action = response.result.action;
                let parameterKey = response.result.parameters.keyword;
                let queryKey = response.result.resolvedQuery;
                console.log(queryKey + action + facebookId);
                if (action === 'enrol-customer') {
                    if (facebookId != '') {
                        this.openEnrolCustomerPage(sender);
                    }

                } else if (action === 'transfer-money') {
                    this.doTextResponse(sender, responseText);
                    amount = response.result.parameters.amount.rechargeAmount;
                    destAccount = response.result.parameters.destAccount;
                    if (amount != 0 && destAccount != '') {
                        this.openTransferPage(sender);
                    }
                } else if (action === 'balance-enquiry') {
                    if (facebookId !== '') {
                        this.openBalanceEnquiryPage(sender);
                    }
                } else {
                    if (this.isDefined(responseData) && this.isDefined(responseData.facebook)) {
                        let facebookResponseData = responseData.facebook;
                        this.doDataResponse(sender, facebookResponseData);
                    } else if (this.isDefined(responseMessages) && responseMessages.length > 0) {
                        this.doRichContentResponse(sender, responseMessages);
                    } else if (this.isDefined(responseText)) {
                        this.doTextResponse(sender, responseText);
                    }
                }

            }
        });

        apiaiRequest.on('error', (error) => console.error(error));
        apiaiRequest.end();

    }

    splitResponse(str) {
        if (str.length <= FB_TEXT_LIMIT) {
            return [str];
        }

        return this.chunkString(str, FB_TEXT_LIMIT);
    }

    chunkString(s, len) {
        let curr = len,
            prev = 0;

        let output = [];

        while (s[curr]) {
            if (s[curr++] == ' ') {
                output.push(s.substring(prev, curr));
                prev = curr;
                curr += len;
            } else {
                let currReverse = curr;
                do {
                    if (s.substring(currReverse - 1, currReverse) == ' ') {
                        output.push(s.substring(prev, currReverse));
                        prev = currReverse;
                        curr = currReverse + len;
                        break;
                    }
                    currReverse--;
                } while (currReverse > prev)
            }
        }
        output.push(s.substr(prev));
        return output;
    }

    sendFBMessage(sender, messageData) {
        return new Promise((resolve, reject) => {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: { access_token: FB_PAGE_ACCESS_TOKEN },
                method: 'POST',
                json: {
                    recipient: { id: sender },
                    message: messageData
                }
            }, (error, response) => {
                if (error) {
                    console.log('Error sending message: ', error);
                    reject(error);
                } else if (response.body.error) {
                    console.log('Error: ', response.body.error);
                    reject(new Error(response.body.error));
                }

                resolve();
            });
        });
    }

    sendFBSenderAction(sender, action) {
        return new Promise((resolve, reject) => {
            request({
                url: 'https://graph.facebook.com/v2.6/me/messages',
                qs: { access_token: FB_PAGE_ACCESS_TOKEN },
                method: 'POST',
                json: {
                    recipient: { id: sender },
                    sender_action: action
                }
            }, (error, response) => {
                if (error) {
                    console.error('Error sending action: ', error);
                    reject(error);
                } else if (response.body.error) {
                    console.error('Error: ', response.body.error);
                    reject(new Error(response.body.error));
                }

                resolve();
            });
        });
    }

    doSubscribeRequest() {
        request({
                method: 'POST',
                uri: `https://graph.facebook.com/v2.6/me/subscribed_apps?access_token=${FB_PAGE_ACCESS_TOKEN}`
            },
            (error, response, body) => {
                if (error) {
                    console.error('Error while subscription: ', error);
                } else {
                    console.log('Subscription result: ', response.body);
                }
            });
    }

    configureGetStartedEvent() {
        request({
                method: 'POST',
                uri: `https://graph.facebook.com/v2.6/me/thread_settings?access_token=${FB_PAGE_ACCESS_TOKEN}`,
                json: {
                    setting_type: "call_to_actions",
                    thread_state: "new_thread",
                    call_to_actions: [{
                        payload: FACEBOOK_WELCOME
                    }]
                }
            },
            (error, response, body) => {
                if (error) {
                    console.error('Error while subscription', error);
                } else {
                    console.log('Subscription result', response.body);
                }
            });
    }

    isDefined(obj) {
        if (typeof obj == 'undefined') {
            return false;
        }

        if (!obj) {
            return false;
        }

        return obj != null;
    }

    sleep(delay) {
        return new Promise((resolve, reject) => {
            setTimeout(() => resolve(), delay);
        });
    }

    /**
     * Open customer onboarded webview
     */

    openEnrolCustomerPage(sender) {
        var messageData = {
            recipient: {
                id: sender
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: "Click the below to get onboarded.",
                        buttons: [{
                            type: "web_url",
                            url: APP_URL + "/onboarded/customer_onboarded.html",
                            title: "Get Onboarded Now",
                            webview_height_ratio: "tall"
                        }]
                    }
                }
            }
        };
        callSendAPI(messageData);
    }


    /**
     * Open Transfer page webview for customer to enter PIN
     */
    openTransferPage(sender) {
        var messageData = {
            recipient: {
                id: sender
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: "Click the button below to do transfer.",
                        buttons: [{
                            type: "web_url",
                            url: APP_URL + "/transfer/transfer.html",
                            title: "Transfer Now",
                            webview_height_ratio: "tall"
                        }]
                    }
                }
            }
        };
        callSendAPI(messageData);
    }

    /**
     * Open Webview to check balance enquiry
     */
    openBalanceEnquiryPage(sender) {
        var messageData = {
            recipient: {
                id: sender
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: "Click the button below to get your account balance.",
                        buttons: [{
                            type: "web_url",
                            url: APP_URL + "/balance/balance_enquiry.html",
                            title: "Get Account Balance",
                            webview_height_ratio: "tall"
                        }]
                    }
                }
            }
        };
        callSendAPI(messageData);
    }
}

//create an instance of facebook bot
let facebookBot = new FacebookBot();
//class to perform transactions based on url provided
class Transactions {
    constructor() {}
        //onboard customer
    customerOnboarded(senderId, query) {
            let url = CUSTOMER_ONBOARDED_URL;
            this.sendRequest(senderId, query, url);
        }
        //do transfer
    doTransfer(senderId, query) {
            let url = TRANSFER_URL;
            this.sendRequest(senderId, query, url);
        }
        //check balance
    checkBalance(senderId, query) {
            let url = CHECK_BALANCE_URL;
            this.sendRequest(senderId, query, url);
        }
        //send request to endpoint
    sendRequest(senderId, query, url) {
        let options = {
            method: 'POST',
            url: url,
            headers: {
                'postman-token': '04f7bdb3-510c-9e01-5c9d-09af21a70517',
                'cache-control': 'no-cache',
                'content-type': 'application/json'
            },
            body: query,
            json: true
        };
        request(options, function(error, response, body) {
            if (error) throw new Error(error);
            console.log("presenting body");
            console.log(body);
            if (body != null | body != '') {
                let responseMessage = body.responseMessage;
                sendTextMessage(senderId, responseMessage);
                if (body.Message) {
                    let message = body.Message;
                    if (message.indexOf("An error has occurred") > -1) {
                        sendTextMessage(senderId, "No amount has been credited into your account.");
                    }
                }
            }
        });
    }
}

let transaction = new Transactions();
const app = express();
app.use(express.static(__dirname + '/public'));

app.use(bodyParser.text({ type: 'application/json' }));

//get onboard html file
app.get('/onboarded/customer_onboarded.html', function(request, response) {
    response.sendFile(__dirname + "/resources/views/" + "customer_onboarded.html");
});

//get user entry from customer onboarded page
app.get('/customer_onboarded', function(request, response) {
    let query = {
        facebookId: facebookId,
        pin: request.query.pin,
        bvn: request.query.bvn,
        accountNumber: request.query.account_number
    };
    transaction.customerOnboarded(senderId, query);
    // console.log(query);
    let display_text = 'Redirecting to chat room'
    let img_url = APP_URL + '/loader/loader_icon.gif';
    response.redirect('https://www.messenger.com/closeWindow/?image_url=' + img_url + '&display_text=' + display_text);
    response.end();
});

//get balance enquiry html file
app.get('/balance/balance_enquiry.html', function(request, response) {
    response.sendFile(__dirname + "/resources/views/" + "balance_enquiry.html");
});
//get user entry from balance enquiry page
app.get('/balance_enquiry', function(request, response) {
    let query = {
        pin: request.query.pin
    };
    transaction.checkBalance(senderId, query);
    console.log(query);
    let display_text = 'Redirecting to chat room'
    let img_url = APP_URL + '/loader/loader_icon.gif';
    response.redirect('https://www.messenger.com/closeWindow/?image_url=' + img_url + '&display_text=' + display_text);
    response.end();
});


//get loader icon for webpage redirect
app.get('/loader/loader_icon.gif', function(request, response) {
    response.sendFile(__dirname + "/public/img/loader_icon.gif");
});

//get transfer html file
app.get('/transfer/transfer.html', function(request, response) {
    response.sendFile(__dirname + "/resources/views/" + "transfer.html");
});
//get user entry from balance enquiry page
app.get('/transfer', function(request, response) {
    let query = {
        facebookId: facebookId,
        destinationAccount: destAccount,
        amount: amount,
        pin: request.query.pin
    };
    transaction.doTransfer(senderId, query);
    console.log(query);
    let display_text = 'Redirecting to chat room'
    let img_url = APP_URL + '/loader/loader_icon.gif';
    response.redirect('https://www.messenger.com/closeWindow/?image_url=' + img_url + '&display_text=' + display_text);
    response.end();
});

app.get('/webhook/', (req, res) => {
    if (req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
        res.send(req.query['hub.challenge']);
        setTimeout(() => {
            facebookBot.doSubscribeRequest();
        }, 3000);
    } else {
        res.send('Error, wrong validation token');
    }
});


app.post('/webhook/', (req, res) => {
    try {
        const data = JSONbig.parse(req.body);

        if (data.entry) {
            let entries = data.entry;
            entries.forEach((entry) => {
                let messaging_events = entry.messaging;
                if (messaging_events) {
                    messaging_events.forEach((event) => {
                        facebookId = event.sender.id;
                        console.log(facebookId);
                        if (event.message && !event.message.is_echo) {
                            if (event.message.attachments) {
                                let locations = event.message.attachments.filter(a => a.type === "location");
                                // delete all locations from original message
                                event.message.attachments = event.message.attachments.filter(a => a.type !== "location");

                                if (locations.length > 0) {
                                    locations.forEach(l => {
                                        let locationEvent = {
                                            sender: event.sender,
                                            postback: {
                                                payload: "FACEBOOK_LOCATION",
                                                data: l.payload.coordinates
                                            }
                                        };

                                        facebookBot.processFacebookEvent(locationEvent);
                                    });
                                }
                            }

                            facebookBot.processMessageEvent(event);
                        } else if (event.postback && event.postback.payload) {
                            if (event.postback.payload === "FACEBOOK_WELCOME") {
                                facebookBot.processFacebookEvent(event);
                            } else {
                                facebookBot.processMessageEvent(event);
                            }
                        }
                    });
                }
            });
        }

        return res.status(200).json({
            status: "ok"
        });
    } catch (err) {
        return res.status(400).json({
            status: "error",
            error: err
        });
    }
});
/*
 * Call the Send API. The message data goes in the body. If successful, we'll 
 * get the message id in a response 
 *
 */
function callSendAPI(messageData) {
    request({
            uri: 'https://graph.facebook.com/v2.6/me/messages',
            qs: { access_token: FB_PAGE_ACCESS_TOKEN },
            method: 'POST',
            json: messageData
        },
        function(error, response, body) {
            //            console.log("sender id is : " + JSON.parse(body));
            if (!error && response.statusCode == 200) {
                const recipientId = body.recipient_id;
                const messageId = body.message_id;
                senderId = recipientId;
                //      console.log("sender id is : " + JSON.parse(body));
                if (messageId) {
                    console.log("Successfully sent message with id %s to recipient %s",
                        messageId, recipientId);
                } else {
                    console.log("Successfully called Send API for recipient %s",
                        recipientId);
                }
            } else {
                console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
            }
        });
}

/*
 * Send a text message using the Send API.
 *
 */

function sendTextMessage(recipientId, messageText) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: messageText,
            metadata: "DEVELOPER_DEFINED_METADATA"
        }
    };

    callSendAPI(messageData);
}

app.listen(REST_PORT, () => {
    console.log('Rest service ready on port ' + REST_PORT);
});

facebookBot.doSubscribeRequest();