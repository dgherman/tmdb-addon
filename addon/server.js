const addon = require('./index.js')
const { logError, redactUrl } = require('./utils/logError')
const PORT = process.env.PORT || 1337;

// Tratamento global de erros não capturados
process.on('unhandledRejection', (reason) => {
  // The rejection reason is very often a raw Axios error carrying credentials
  // in its request config, so it must never be serialized wholesale.
  logError('Unhandled promise rejection', reason);
  // Não encerra o processo, apenas loga o erro
});

process.on('uncaughtException', (error) => {
  logError('Uncaught exception', error);
  if (error?.stack) {
    console.error(redactUrl(error.stack.split('\n').slice(0, 5).join('\n')));
  }
  // Não encerra o processo imediatamente, permite que o servidor continue
  // mas loga o erro para debug
});

addon.listen(PORT, function () {
  console.log(`Addon active on port ${PORT}.`);
  console.log(`http://localhost:${PORT}/`);
});
