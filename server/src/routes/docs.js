const fs = require('fs');
const path = require('path');

const SWAGGER_UI_VERSION = '5.17.14';
const SPEC_PATH = path.join(__dirname, '..', 'openapi.json');

let cachedSpec = null;

function getSpec() {
  if (!cachedSpec) {
    cachedSpec = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
  }
  return cachedSpec;
}

function docsHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>سوق الرافدين — API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          url: './openapi.json',
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: 'StandaloneLayout'
        });
      };
    </script>
  </body>
</html>`;
}

function registerDocs(router) {
  router.get('/openapi.json', (req, res) => {
    res.json(getSpec());
  });
  router.get('/', (req, res) => {
    res.type('html').send(docsHtml());
  });
  return router;
}

module.exports = { registerDocs, getSpec };
