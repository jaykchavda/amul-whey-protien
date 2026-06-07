const { chromium } = require('playwright');
require('dotenv').config();

// Configuration
const PINCODE = '380016';
const AMUL_URL = 'https://shop.amul.com/en/browse/protein';

async function run() {
  console.log('==================================================');
  console.log(`Starting Amul Whey Protein Stock Checker for Pincode: ${PINCODE}`);
  console.log('==================================================\n');

  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext({
    viewport: {
      width: 1366,
      height: 768
    },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  page.on('requestfailed', request => {
    console.log(
      'REQUEST FAILED:',
      request.url(),
      request.failure()?.errorText
    );
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(
        'BAD RESPONSE:',
        response.status(),
        response.url()
      );
    }
  });

  try {
    console.log(`Navigating to: ${AMUL_URL}`);

    await page.goto(AMUL_URL, {
      waitUntil: 'load',
      timeout: 60000
    });

    await page.screenshot({
      path: '01-page-loaded.png',
      fullPage: true
    });

    console.log('Waiting for the location pincode input widget...');

    await page.waitForSelector('#search', {
      timeout: 15000
    });

    console.log(`Entering location pincode: ${PINCODE}`);

    await page.click('#search');
    await page.fill('#search', PINCODE);

    await page.waitForTimeout(3000);

    await page.screenshot({
      path: '02-pincode-entered.png',
      fullPage: true
    });

    console.log('Submitting the location form...');

    await page.keyboard.press('Enter');

    console.log('Waiting for local store inventory to load...');

    await page.waitForTimeout(5000);

    await page.screenshot({
      path: '03-after-enter.png',
      fullPage: true
    });

    const isModalVisible = await page
      .locator('#locationWidgetModal')
      .isVisible()
      .catch(() => false);

    console.log('Modal visible:', isModalVisible);

    if (isModalVisible) {
      console.log(
        'Warning: Pincode modal did not auto-close.'
      );

      await page.screenshot({
        path: '04-modal-stuck.png',
        fullPage: true
      });

      await page.keyboard.press('Escape');

      await page.waitForTimeout(1000);
    }

    console.log('Scanning all products...');

    const allProducts = await page.evaluate(() => {
      const cards = document.querySelectorAll('.product-grid-item');

      return Array.from(cards).map(card => {
        const href =
          card
            .querySelector('a[href*="/product/"]')
            ?.getAttribute('href') || '';

        const innerText = card.innerText
          ? card.innerText.trim()
          : '';

        const lines = innerText
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean);

        return {
          href,
          lines
        };
      });
    });

    console.log(
      `Found ${allProducts.length} total protein products.`
    );

    const wheyProducts = [];

    const ignoredKeywords = [
      'NEW',
      'BESTSELLER',
      'TRENDING',
      'SOLD OUT',
      'ADD',
      'NOTIFY ME'
    ];

    for (const prod of allProducts) {
      const { href, lines } = prod;

      const link = href
        ? new URL(href, AMUL_URL).toString()
        : '';

      const isSoldOut = lines.some(line => {
        const upper = line.toUpperCase();

        return (
          upper === 'SOLD OUT' ||
          upper === 'NOTIFY ME'
        );
      });

      let title = '';
      let description = '';
      let price = 'N/A';

      for (const line of lines) {
        const upperLine = line.toUpperCase();

        if (ignoredKeywords.includes(upperLine))
          continue;

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

      const lowerTitle = title.toLowerCase();

      if (
        lowerTitle.includes('whey') &&
        (
          lowerTitle.includes('30 sachets') ||
          lowerTitle.includes('60 sachets')
        )
      ) {
        wheyProducts.push({
          title,
          description,
          price,
          isSoldOut,
          status: isSoldOut
            ? 'Sold Out'
            : 'IN STOCK',
          link
        });
      }
    }

    console.log('\n--------------------------------------------------');
    console.log('               WHEY PROTEIN OPTIONS               ');
    console.log('--------------------------------------------------');

    if (wheyProducts.length === -1) {
      console.log(
        'No whey protein options matching filter found.'
      );
    } else {
      console.table(
        wheyProducts.map(product => ({
          Title: product.title,
          Price: product.price,
          Status: product.status
        }))
      );
    }

    console.log('--------------------------------------------------\n');

    const inStockProducts = wheyProducts.filter(
      product => !product.isSoldOut
    );

    if (inStockProducts.length > 0) {
      console.log(
        `🎉 Success! Found ${inStockProducts.length} whey protein option(s) in stock:`
      );

      inStockProducts.forEach(product =>
        console.log(
          ` - ${product.title} (${product.price})`
        )
      );

      await handleTelegramNotification(
        inStockProducts,
        wheyProducts
      );
    } else {
      console.log(
        '❌ All targeted whey protein options are currently Sold Out.'
      );
    }
  } catch (error) {
    console.error(
      'Error occurred during execution:',
      error
    );

    try {
      await page.screenshot({
        path: 'error-screenshot.png',
        fullPage: true
      });
    } catch {}
  } finally {
    await browser.close();

    console.log('\nExecution finished.');
  }
}

async function handleTelegramNotification(
  inStockProducts,
  allWheyProducts
) {
  const {
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID
  } = process.env;

  const botMessage = [
    `<b>🚨 Amul Whey Protein Restock Alert! 🚨</b>`,
    `Pincode: <b>${PINCODE}</b>\n`,
    `The following whey protein options are currently <b>IN STOCK</b>:`,
    inStockProducts
      .map(
        product =>
          `• <a href="${product.link}">${product.title}</a> - <b>${product.price}</b>`
      )
      .join('\n'),
    `\n<b>Current Stock Status:</b>`,
    allWheyProducts
      .map(product => {
        const emoji = product.isSoldOut
          ? '🔴'
          : '🟢';

        const status = product.isSoldOut
          ? 'Sold Out'
          : 'IN STOCK';

        return `${emoji} <a href="${product.link}">${product.title}</a> - <b>${product.price}</b> (${status})`;
      })
      .join('\n')
  ].join('\n');

  if (
    !TELEGRAM_BOT_TOKEN ||
    !TELEGRAM_CHAT_ID
  ) {
    console.log(
      'Telegram notification not configured.'
    );
    return;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
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
      }
    );

    const data = await response.json();

    if (response.ok && data.ok) {
      console.log(
        '📱 Telegram alert sent successfully!'
      );
    } else {
      console.error(
        'Telegram API Error:',
        data.description
      );
    }
  } catch (error) {
    console.error(
      'Failed to send Telegram notification:',
      error
    );
  }
}

run();