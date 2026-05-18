const { LINK_TEMPLATES } = require('../utils/constants');

/**
 * Given a single video ID, constructs all three server links.
 *
 * @param {string} videoId
 * @returns {{ rpm: string, p2p: string, upn: string }}
 */
function buildLinks(videoId) {
  return {
    rpm: LINK_TEMPLATES.rpm(videoId),
    p2p: LINK_TEMPLATES.p2p(videoId),
    upn: LINK_TEMPLATES.upn(videoId),
  };
}

module.exports = { buildLinks };
