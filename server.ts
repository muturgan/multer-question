import Bluebird = require('bluebird');
global.Promise = Bluebird;

import dotenv = require('dotenv');
dotenv.config();
const PORT = process.env.PORT;

import server from './app';
import logger from './logger';

import Domain = require('domain');
const domain = Domain.create();
domain.on('error', (error) => {
    logger.error(`Domain error`, error);
});

domain.run(() => {
    server.listen(PORT, () => {
        logger.info(`Express server listening on port ${ PORT }`);
    });
});
