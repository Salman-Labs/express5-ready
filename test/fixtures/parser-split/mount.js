const express = require('express');
const { urlencoded } = require('body-parser');
const app = express();

app.use(urlencoded({ extended: false }));
