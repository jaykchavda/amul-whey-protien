const { chromium } = require('playwright');
require('dotenv').config();

// Configuration
const PINCODE = '380016';
const AMUL_URL = 'https://shop.amul.com/en/browse/protein';

async function run() {
  console.log('==================================================');
  console.log(`Starting Amul Whey Protein Stock Checker for Pincode: ${PINCODE}`);
  console.log('==================================================\n');

  // const isGithubAction = process.env.GITHUB_ACTIONS === 'true';
  const isGithubAction = 'true'
  console.log(`Launching browser (${isGithubAction ? 'Playwright Chromium' : 'local Chrome'})...`);
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
  });

  const page = await browser.newPage();
  
  try {
    console.log(`Navigating to: ${AMUL_URL}`);
    await page.goto(AMUL_URL, { waitUntil: 'load', timeout: 60000 });

    console.log('Waiting for the location pincode input widget...');
    await page.waitForSelector('#search', { timeout: 15000 });

    console.log(`Entering location pincode: ${PINCODE}`);
    await page.focus('#search');
    await page.type('#search', PINCODE, { delay: 100 });

    // Wait a brief moment to let autocomplete/event handlers process
    await page.waitForTimeout(2000);

    console.log('Submitting the location form...');
    await page.keyboard.press('Enter');

    console.log('Waiting for local store inventory to load...');
    await page.waitForTimeout(5000);

    // Verify modal has closed
    const isModalVisible = await page.isVisible('#locationWidgetModal');
    if (isModalVisible) {
      console.log('Warning: Pincode modal did not auto-close. Attempting to click outside/close...');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1000);
    }

    console.log('Scanning all products...');
    const allProducts = await page.evaluate(() => {
      const cards = document.querySelectorAll('.product-grid-item');
      return Array.from(cards).map(card => {
        const href = card.querySelector('a[href*="/product/"]')?.getAttribute('href') || '';
        const innerText = card.innerText ? card.innerText.trim() : '';
        const lines = innerText.split('\n').map(l => l.trim()).filter(Boolean);
        return { href, lines };
      });
    });

    console.log(`Found ${allProducts.length} total protein products.`);

    // Parse products and filter for Whey Protein
    const wheyProducts = [];
    const ignoredKeywords = ['NEW', 'BESTSELLER', 'TRENDING', 'SOLD OUT', 'ADD', 'NOTIFY ME'];

    for (const prod of allProducts) {
      const { href, lines } = prod;
      const link = href ? new URL(href, AMUL_URL).toString() : '';

      // Determine stock status
      const isSoldOut = lines.some(line => {
        const upper = line.toUpperCase();
        return upper === 'SOLD OUT' || upper === 'NOTIFY ME';
      });

      // Parse title, price, and description
      let title = '';
      let description = '';
      let price = 'N/A';

      for (const line of lines) {
        const upperLine = line.toUpperCase();
        if (ignoredKeywords.includes(upperLine)) continue;
        if (line.startsWith('MRP₹')) {
          price = line.replace('MRP', '').trim();
          continue;
        }
        if (line.includes('(USP')) continue;

        if (!title) {
          title = line;
        } else if (!description) {
          description = line;
        }
      }

      // Filter for whey protein options (title contains "whey" AND "30 sachets" or "60 sachets")
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes('whey') && (lowerTitle.includes('30 sachets') || lowerTitle.includes('60 sachets'))) {
        wheyProducts.push({
          title,
          description,
          price,
          isSoldOut,
          status: isSoldOut ? 'Sold Out' : 'IN STOCK',
          link
        });
      }
    }

    console.log('\n--------------------------------------------------');
    console.log('               WHEY PROTEIN OPTIONS               ');
    console.log('--------------------------------------------------');
    
    if (wheyProducts.length === 0) {
      console.log('No whey protein options matching filter found.');
    } else {
      console.table(wheyProducts.map(p => ({
        Title: p.title,
        Price: p.price,
        Status: p.status
      })));
    }
    console.log('--------------------------------------------------\n');

    // Check if any whey protein is in stock (not sold out)
    const inStockProducts = wheyProducts.filter(p => !p.isSoldOut);

    if (inStockProducts.length > -1) {
      console.log(`🎉 Success! Found ${inStockProducts.length} whey protein option(s) in stock:`);
      inStockProducts.forEach(p => console.log(` - ${p.title} (${p.price})`));
      
      // Attempt to send Telegram notification
      await handleTelegramNotification(inStockProducts, wheyProducts);
    } else {
      console.log('❌ All targeted whey protein options are currently Sold Out. No Telegram alert triggered.');
    }

  } catch (error) {
    console.error('Error occurred during execution:', error);
  } finally {
    await browser.close();
    console.log('\nExecution finished.');
  }
}

async function handleTelegramNotification(inStockProducts, allWheyProducts) {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

  // Prepare text content
  const botMessage = [
    `<b>🚨 Amul Whey Protein Restock Alert! 🚨</b>`,
    `Pincode: <b>${PINCODE}</b>\n`,
    `The following whey protein options are currently <b>IN STOCK</b>:`,
    inStockProducts.map(p => `• <a href="${p.link}">${p.title}</a> - <b>${p.price}</b>`).join('\n'),
    `\n<b>Current Stock Status:</b>`,
    allWheyProducts.map(p => {
      const statusEmoji = p.isSoldOut ? '🔴' : '🟢';
      const statusText = p.isSoldOut ? 'Sold Out' : 'IN STOCK';
      return `${statusEmoji} <a href="${p.link}">${p.title}</a> - <b>${p.price}</b> (${statusText})`;
    }).join('\n')
  ].join('\n');

  console.log('\n--- Telegram Notification Payload ---');
  console.log(botMessage.replace(/<[^>]*>/g, '')); // log stripped tags text
  console.log('--------------------------------------');

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || TELEGRAM_BOT_TOKEN.includes('your_bot_token') || TELEGRAM_CHAT_ID.includes('your_chat_id')) {
    console.log('\n⚠️ Telegram notification not configured.');
    console.log('To receive Telegram alerts, please fill in your TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the ".env" file.');
    return;
  }

  console.log('\nSending Telegram alert...');
  
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: botMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      })
    });

    const data = await response.json();
    if (response.ok && data.ok) {
      console.log('📱 Telegram alert sent successfully!');
    } else {
      console.error('❌ Telegram API Error:', data.description || response.statusText);
    }
  } catch (error) {
    console.error('❌ Failed to send Telegram notification:', error);
  }
}

run();
