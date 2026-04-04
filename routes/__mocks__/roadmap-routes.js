'use strict';
/** Jest manual mock — returns an empty Express Router. */
const { Router } = require('express');
module.exports = () => Router();
