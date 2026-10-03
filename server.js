const express = require('express');
const { Pool } = require('pg');
const app = express();

app.use(express.json());

// الاتصال بقاعدة البيانات عبر رابط Render
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// دالة لإنشاء الجداول تلقائياً عند تشغيل السيرفر لأول مرة
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS wallets (
                user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                coins_balance INT DEFAULT 0,
                creator_earnings DECIMAL(10,2) DEFAULT 0.00
            );

            CREATE TABLE IF NOT EXISTS gifts (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                cost_coins INT NOT NULL,
                animation_type VARCHAR(50) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                sender_id INT REFERENCES users(id),
                creator_id INT REFERENCES users(id),
                gift_id INT REFERENCES gifts(id),
                coins_spent INT NOT NULL,
                creator_revenue DECIMAL(10,2) NOT NULL,
                platform_revenue DECIMAL(10,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("تم التحقق من جداول قاعدة البيانات أو إنشاؤها بنجاح!");
    } catch (err) {
        console.error("خطأ في إنشاء الجداول:", err);
    }
}

initDB();

// نقطة اختبار لتأكد أن السيرفر يعمل
app.get('/', (req, res) => {
    res.send('مرحباً بك في سيرفر تطبيق TikTop يعمل بنجاح!');
});

// نظام إرسال الهدية وحساب نسبة 75% لصانع المحتوى
app.post('/api/send-gift', async (req, res) => {
    const { sender_id, creator_id, gift_id } = req.body;
    
    try {
        const giftQuery = await pool.query('SELECT * FROM gifts WHERE id = $1', [gift_id]);
        if (giftQuery.rows.length === 0) return res.status(404).json({ error: 'الهدية غير موجودة' });
        
        const gift = giftQuery.rows[0];
        const cost = gift.cost_coins;

        const senderWallet = await pool.query('SELECT coins_balance FROM wallets WHERE user_id = $1', [sender_id]);
        if (senderWallet.rows.length === 0 || senderWallet.rows[0].coins_balance < cost) {
            return res.status(400).json({ error: 'رصيد العملات غير كافٍ للشحن' });
        }

        const creatorRevenue = cost * 0.75;
        const platformRevenue = cost * 0.25;

        await pool.query('BEGIN');
        
        await pool.query('UPDATE wallets SET coins_balance = coins_balance - $1 WHERE user_id = $2', [cost, sender_id]);
        await pool.query('UPDATE wallets SET creator_earnings = creator_earnings + $1 WHERE user_id = $2', [creatorRevenue, creator_id]);
        await pool.query(
            'INSERT INTO transactions (sender_id, creator_id, gift_id, coins_spent, creator_revenue, platform_revenue) VALUES ($1, $2, $3, $4, $5, $6)',
            [sender_id, creator_id, gift_id, cost, creatorRevenue, platformRevenue]
        );

        await pool.query('COMMIT');

        res.status(200).json({ 
            success: true, 
            message: 'تم إرسال الهدية بنجاح!', 
            details: { cost, creatorRevenue } 
        });

    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ error: 'حدث خطأ أثناء معالجة الهدية', details: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`السيرفر يعمل الآن على البورت ${PORT}`);
});
