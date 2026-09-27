"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suggestBibKey = exports.summarizeText = void 0;
const textSummary_1 = require("./functions/textSummary");
Object.defineProperty(exports, "summarizeText", { enumerable: true, get: function () { return textSummary_1.summarizeText; } });
const refTools_1 = require("./functions/refTools");
Object.defineProperty(exports, "suggestBibKey", { enumerable: true, get: function () { return refTools_1.suggestBibKey; } });
