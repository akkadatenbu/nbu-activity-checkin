// src/line-oa/line-api.js
// LINE Messaging API utilities — push, multicast

export async function pushFlexMessage(to, message) {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ to, messages: [message] }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`LINE push failed ${res.status}: ${body}`);
    }
}
