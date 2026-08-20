const sharp = require('sharp');
const axios = require('axios');
const { logError } = require('./logError');

async function blurImage(imageUrl) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000
    });

    const processedImageBuffer = await sharp(response.data)
      .blur(20)
      .toBuffer();

    return processedImageBuffer;
  } catch (error) {
    logError('blurImage: failed to fetch or process the image', error);
    return null;
  }
}

module.exports = { blurImage }; 