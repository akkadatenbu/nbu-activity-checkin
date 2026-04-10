// src/line-oa/webhook.js — LINE Messaging API webhook + Flex Messages
import { Router } from 'express';
import crypto from 'crypto';
import { query } from '../api/db.js';

const router = Router();

// ─── Verify LINE signature ────────────────────────────────────────────────────
function verifySignature(body, signature) {
    const secret = process.env.LINE_CHANNEL_SECRET;
    if (!secret) return false;
    const hash = crypto
        .createHmac('sha256', secret)
        .update(body)
        .digest('base64');
    return hash === signature;
}

// ─── LINE API helpers ─────────────────────────────────────────────────────────
async function replyMessage(replyToken, messages) {
    await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({ replyToken, messages }),
    });
}

// ─── Flex Message builders ────────────────────────────────────────────────────
function buildActivityFlex(records) {
    if (!records.length) {
        return {
            type: 'text',
            text: 'คุณยังไม่มีประวัติการเข้าร่วมกิจกรรม',
        };
    }

    const bubbles = records.map(r => ({
        type: 'bubble',
        size: 'kilo',
        header: {
            type: 'box',
            layout: 'vertical',
            contents: [{
                type: 'text',
                text: '✅ เข้าร่วมแล้ว',
                size: 'xs',
                color: '#ffffff',
                weight: 'bold',
            }],
            backgroundColor: '#003B7A',
            paddingAll: '10px',
        },
        body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
                {
                    type: 'text',
                    text: r.activity_title,
                    weight: 'bold',
                    size: 'sm',
                    wrap: true,
                    maxLines: 2,
                },
                {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'md',
                    spacing: 'xs',
                    contents: [
                        infoRow('📅', formatThaiDate(r.start_datetime)),
                        infoRow('📍', r.location || 'ไม่ระบุสถานที่'),
                        infoRow('🕐', `เช็คชื่อ ${formatThaiTime(r.checked_at)}`),
                    ],
                },
            ],
            paddingAll: '14px',
        },
    }));

    // แบ่ง carousel ครั้งละ 10 bubble (LINE limit)
    return {
        type: 'flex',
        altText: `ประวัติการเข้าร่วมกิจกรรม ${records.length} รายการ`,
        contents: {
            type: 'carousel',
            contents: bubbles.slice(0, 10),
        },
    };
}

function infoRow(icon, text) {
    return {
        type: 'box',
        layout: 'baseline',
        spacing: 'sm',
        contents: [
            { type: 'text', text: icon, size: 'sm', flex: 0 },
            { type: 'text', text: text, size: 'xs', color: '#555555', flex: 1, wrap: true },
        ],
    };
}

function buildSummaryFlex(studentName, records) {
    return {
        type: 'flex',
        altText: `สรุปการเข้าร่วมกิจกรรม`,
        contents: {
            type: 'bubble',
            header: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    { type: 'text', text: 'ประวัติกิจกรรม', color: '#ffffff', weight: 'bold', size: 'md' },
                    { type: 'text', text: studentName, color: '#93c5fd', size: 'sm' },
                ],
                backgroundColor: '#003B7A',
                paddingAll: '16px',
            },
            body: {
                type: 'box',
                layout: 'vertical',
                spacing: 'md',
                contents: [
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            statBox('เข้าร่วมทั้งหมด', String(records.length), '#003B7A'),
                            statBox('เดือนนี้', String(records.filter(r => isThisMonth(r.checked_at)).length), '#22c55e'),
                        ],
                        spacing: 'md',
                    },
                    { type: 'separator' },
                    {
                        type: 'text',
                        text: records.length
                            ? `กิจกรรมล่าสุด: ${records[0].activity_title}`
                            : 'ยังไม่มีประวัติ',
                        size: 'xs',
                        color: '#555555',
                        wrap: true,
                    },
                ],
                paddingAll: '16px',
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                contents: [{
                    type: 'button',
                    action: { type: 'message', label: 'ดูทั้งหมด', text: 'กิจกรรม' },
                    style: 'primary',
                    color: '#003B7A',
                    height: 'sm',
                }],
                paddingAll: '12px',
            },
        },
    };
}

function statBox(label, value, color) {
    return {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        alignItems: 'center',
        contents: [
            { type: 'text', text: value, size: 'xxl', weight: 'bold', color },
            { type: 'text', text: label, size: 'xxs', color: '#888888' },
        ],
    };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function formatThaiDate(d) {
    return new Date(d).toLocaleDateString('th-TH', { dateStyle: 'medium' });
}
function formatThaiTime(d) {
    return new Date(d).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
}
function isThisMonth(d) {
    const now = new Date();
    const dt  = new Date(d);
    return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
}

// ─── Handle LINE events ───────────────────────────────────────────────────────
async function handleMessage(event) {
    const { replyToken, source, message } = event;
    if (message.type !== 'text') return;

    const lineUuid = source.userId;
    const text     = message.text.trim();

    // หา student จาก line_student_links (ข้อมูล LINE UUID ↔ student_id)
    const { rows } = await query(
        `SELECT s.student_id, s.full_name
         FROM nbu_students s
         JOIN line_student_links l ON l.student_id = s.student_id
         WHERE l.line_user_id = $1`,
        [lineUuid]
    );

    if (!rows.length) {
        await replyMessage(replyToken, [{
            type: 'text',
            text: 'ไม่พบข้อมูลนักศึกษาที่เชื่อมกับ LINE นี้\nกรุณาติดต่อเจ้าหน้าที่',
        }]);
        return;
    }

    const student = rows[0];

    if (text === 'กิจกรรม' || text === 'ประวัติกิจกรรม') {
        // ดึงประวัติทั้งหมด
        const { rows: records } = await query(
            `SELECT att.checked_at, a.title AS activity_title, a.location, a.start_datetime
             FROM nbu_attendance att
             JOIN nbu_activities a ON a.id = att.activity_id
             WHERE att.student_id = $1
             ORDER BY att.checked_at DESC
             LIMIT 10`,
            [student.student_id]
        );

        await replyMessage(replyToken, [
            buildSummaryFlex(student.full_name, records),
            ...(records.length ? [buildActivityFlex(records)] : []),
        ]);

    } else if (text === 'กิจกรรมล่าสุด') {
        // ดึง 5 รายการล่าสุด
        const { rows: records } = await query(
            `SELECT att.checked_at, a.title AS activity_title, a.location, a.start_datetime
             FROM nbu_attendance att
             JOIN nbu_activities a ON a.id = att.activity_id
             WHERE att.student_id = $1
             ORDER BY att.checked_at DESC
             LIMIT 5`,
            [student.student_id]
        );

        if (!records.length) {
            await replyMessage(replyToken, [{ type: 'text', text: 'คุณยังไม่มีประวัติการเข้าร่วมกิจกรรม' }]);
        } else {
            await replyMessage(replyToken, [buildActivityFlex(records)]);
        }

    } else {
        // เมนูช่วยเหลือ
        await replyMessage(replyToken, [{
            type: 'flex',
            altText: 'เมนูกิจกรรม',
            contents: {
                type: 'bubble',
                body: {
                    type: 'box',
                    layout: 'vertical',
                    spacing: 'sm',
                    contents: [
                        { type: 'text', text: `สวัสดี ${student.full_name}`, weight: 'bold', size: 'md' },
                        { type: 'text', text: 'พิมพ์คำสั่งด้านล่าง:', size: 'sm', color: '#555555', margin: 'md' },
                        { type: 'separator', margin: 'md' },
                        menuRow('กิจกรรม', 'ดูประวัติการเข้าร่วมทั้งหมด'),
                        menuRow('กิจกรรมล่าสุด', 'ดู 5 กิจกรรมล่าสุด'),
                    ],
                    paddingAll: '16px',
                },
            },
        }]);
    }
}

function menuRow(cmd, desc) {
    return {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [
            { type: 'text', text: cmd,  size: 'sm', weight: 'bold', color: '#003B7A', flex: 2 },
            { type: 'text', text: desc, size: 'xs', color: '#888888', flex: 3, wrap: true },
        ],
    };
}

// ─── POST /line/webhook ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
    // ตอบ 200 ก่อนเสมอ (LINE timeout 30s)
    res.sendStatus(200);

    const signature = req.headers['x-line-signature'];
    if (!verifySignature(req.body, signature)) {
        console.warn('LINE webhook: invalid signature');
        return;
    }

    let body;
    try {
        body = JSON.parse(req.body.toString());
    } catch {
        return;
    }

    for (const event of (body.events || [])) {
        if (event.type === 'message') {
            handleMessage(event).catch(err => console.error('LINE handler error:', err));
        }
    }
});

export default router;
