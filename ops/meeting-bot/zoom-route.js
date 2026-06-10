"use strict";
// AI NoteTacker patch of the upstream meeting-bot dist/app/zoom.js: accepts an
// optional `meetingPassword` field and forwards it to ZoomBot.join so the bot can
// fill Zoom's passcode input. Keep the rest in sync with the upstream file.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ZoomBot_1 = require("../bots/ZoomBot");
const axios_1 = require("axios");
const logger_1 = require("../util/logger");
const disk_uploader_1 = __importDefault(require("../middleware/disk-uploader"));
const recordingName_1 = require("../util/recordingName");
const strings_1 = require("../util/strings");
const globalJobStore_1 = require("../lib/globalJobStore");
const router = express_1.default.Router();
const joinZoom = async (req, res) => {
    const { bearerToken, url, name, teamId, timezone, userId, eventId, botId, meetingPassword } = req.body;
    // Validate required fields
    if (!bearerToken || !url || !name || !teamId || !timezone || !userId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: bearerToken, url, name, teamId, timezone, userId'
        });
    }
    if (!botId && !eventId) {
        return res.status(400).json({
            success: false,
            error: 'Missing required fields: botId or eventId'
        });
    }
    // Create correlation ID and logger
    const correlationId = (0, logger_1.createCorrelationId)({ teamId, userId, botId, eventId, url });
    const logger = (0, logger_1.loggerFactory)(correlationId, 'zoom');
    try {
        // Try to add the job to the store
        const jobResult = await globalJobStore_1.globalJobStore.addJob(async () => {
            // Initialize disk uploader
            const entityId = botId ?? eventId;
            const tempId = `${userId}${entityId}0`; // Using 0 as retry count
            const tempFileId = (0, strings_1.encodeFileNameSafebase64)(tempId);
            const namePrefix = (0, recordingName_1.getRecordingNamePrefix)('zoom');
            const uploader = await disk_uploader_1.default.initialize(bearerToken, teamId, timezone, userId, botId ?? '', namePrefix, tempFileId, logger, url);
            // Create and join the meeting
            const bot = new ZoomBot_1.ZoomBot(logger, correlationId);
            await bot.join({ url, name, bearerToken, teamId, timezone, userId, eventId, botId, uploader, meetingPassword });
        }, logger);
        if (!jobResult.accepted) {
            return res.status(409).json({
                success: false,
                error: 'Another meeting is currently being processed. Please try again later.',
                data: { userId, teamId, eventId, botId }
            });
        }
        // Job was accepted, return immediate response
        logger.info('Zoom job accepted and started processing', { userId, teamId });
        return res.status(202).json({
            success: true,
            message: 'Zoom join request accepted and processing started',
            data: {
                userId,
                teamId,
                eventId,
                botId,
                status: 'processing'
            }
        });
    }
    catch (error) {
        logger.error('Error setting up Zoom job:', { userId, teamId, botId, eventId, error });
        if (error instanceof axios_1.AxiosError) {
            logger.error('axios error', {
                userId,
                teamId,
                botId,
                data: error?.response?.data,
                config: error?.response?.config
            });
        }
        // Return appropriate error response
        const statusCode = error instanceof axios_1.AxiosError ? (error.response?.status || 500) : 500;
        return res.status(statusCode).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
            data: { userId, teamId, eventId, botId }
        });
    }
};
router.post('/join', joinZoom);
exports.default = router;
