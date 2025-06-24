/**
 * Centralized logging utility
 * Provides structured logging with different levels and formatting
 */

const winston = require('winston');
const path = require('path');

class Logger {
    constructor(module = 'App') {
        this.module = module;
        this.logger = this.createLogger();
    }

    createLogger() {
        // Create logs directory if it doesn't exist
        const fs = require('fs');
        const logsDir = path.join(process.cwd(), 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const logLevel = process.env.LOG_LEVEL || 'info';
        
        return winston.createLogger({
            level: logLevel,
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.errors({ stack: true }),
                winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    const moduleName = `[${this.module}]`.padEnd(20);
                    
                    if (stack) {
                        return `${timestamp} ${level.toUpperCase().padEnd(5)} ${moduleName} ${message}\n${stack}${metaStr}`;
                    }
                    
                    return `${timestamp} ${level.toUpperCase().padEnd(5)} ${moduleName} ${message}${metaStr}`;
                })
            ),
            transports: [
                // Console output
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
                            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                            const moduleName = `[${this.module}]`.padEnd(20);
                            
                            if (stack) {
                                return `${timestamp} ${level.padEnd(15)} ${moduleName} ${message}\n${stack}${metaStr}`;
                            }
                            
                            return `${timestamp} ${level.padEnd(15)} ${moduleName} ${message}${metaStr}`;
                        })
                    )
                }),
                
                // File output for all logs
                new winston.transports.File({
                    filename: path.join(logsDir, 'combined.log'),
                    maxsize: 10 * 1024 * 1024, // 10MB
                    maxFiles: 5
                }),
                
                // File output for errors only
                new winston.transports.File({
                    filename: path.join(logsDir, 'errors.log'),
                    level: 'error',
                    maxsize: 10 * 1024 * 1024, // 10MB
                    maxFiles: 5
                })
            ]
        });
    }

    debug(message, meta = {}) {
        this.logger.debug(message, meta);
    }

    info(message, meta = {}) {
        this.logger.info(message, meta);
    }

    warn(message, meta = {}) {
        this.logger.warn(message, meta);
    }

    error(message, error = null, meta = {}) {
        if (error instanceof Error) {
            meta.error = {
                name: error.name,
                message: error.message,
                stack: error.stack
            };
        } else if (error) {
            meta.error = error;
        }
        
        this.logger.error(message, meta);
    }

    fatal(message, error = null, meta = {}) {
        this.error(`FATAL: ${message}`, error, meta);
        
        // Exit process after fatal error
        process.nextTick(() => {
            process.exit(1);
        });
    }

    // Performance logging
    time(label) {
        console.time(`[${this.module}] ${label}`);
    }

    timeEnd(label) {
        console.timeEnd(`[${this.module}] ${label}`);
    }

    // Trade-specific logging
    trade(action, data) {
        this.info(`TRADE: ${action}`, {
            trade: true,
            action,
            ...data
        });
    }

    // Signal-specific logging
    signal(type, data) {
        this.info(`SIGNAL: ${type}`, {
            signal: true,
            type,
            ...data
        });
    }

    // Security-specific logging
    security(event, data) {
        this.warn(`SECURITY: ${event}`, {
            security: true,
            event,
            ...data
        });
    }

    // API request logging
    apiRequest(method, url, statusCode, responseTime) {
        this.info(`API: ${method} ${url}`, {
            api: true,
            method,
            url,
            statusCode,
            responseTime
        });
    }
}

module.exports = Logger;