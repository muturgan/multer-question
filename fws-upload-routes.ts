import { Request, Response } from 'express';
import db from '../../db-controller';
import logger from '../../logger';
import { decodeEntity, updateEntity, attackerDetails, getEntityFromUrl } from '../support-functions';
import multer = require('multer');
import authService from '../auth-service';
import path = require('path');
import fs = require('fs');
const mkdirp: (path: fs.PathLike, mode?: number) => Promise<void> = require('async-mkdirp');


const availableReqContentTypes = ['multipart/form-data'];
const availableMineType = 'application/octet-stream';
const availableExts = ['.bin'];
const maxSize = 3 * 1024 * 1024 * 1024; // 3Gb


const uploadFw = multer({
    limits: { fileSize: maxSize },

    storage: multer.diskStorage({
        destination: (req: Request, file, next) => {
            const deltaVersion = req.body.deltaVersion;

            if (!deltaVersion) {
                mkdirp(`static/files/fws/${ req.body.fwId }/main`)
                    .then( () => next(null, `static/files/fws/${ req.body.fwId }/main`) )
                    .catch( error => next(new Error('mkdirp'), ``) );
            } else {
                mkdirp(`static/files/fws/${ req.body.fwId }/delta/${ deltaVersion }`)
                    .then( () => next(null, `static/files/fws/${ req.body.fwId }/delta/${ deltaVersion }`) )
                    .catch( error => next(error, '') );
            }
        },

        filename: (req, file, next) => {
            if (!file || !file.originalname) {
                next(new Error('406'), '');

            } else {
                next(null, file.originalname.replace(' ', '_'));
            }
        }
    }),

    fileFilter: async (req: Request, file, next) => {
        try {
            if (!file || !file.originalname) {
                return next(new Error('406'), false);
            }

            if (!req.body || !req.body.fwId || req.body.fwId === '') {
                return next(new Error('424'), false);
            }

            const ext = path.extname(file.originalname).toLowerCase();
            if ( !availableExts.includes(ext) || file.mimetype !== availableMineType) {
                return next(new Error('422'), false);
            }

            const rows = await db.sqlGetRequest(`
                SELECT fwId FROM fws WHERE fwId="${ req.body.fwId }";
            `);

            if (rows.length === 0) {
                return next(new Error('424'), false);
            }

            next(null, true);
        } catch (error) {
            next(error, false);
        }
      }
}).any();



export class FwsUploadAdminRoutes {

    public routes(app): void {

        app.route('/api/admin/fws/upload/:versionStatus')
            .post( async (req: Request, res: Response) => {
                try {
                    const validity = await authService.verifyToken(req, true);

                    if (!validity.authorized) {
                        logger.error(`unauthorized user tried to upload new fw as admin`, attackerDetails(req));
                        res.sendStatus(401);
                    } else {

                        if (validity.permissions <= 6) {
                            logger.error(`user with low permissions tried to upload new fw as admin`, attackerDetails(req));
                            res.sendStatus(403);

                        } else {
                            const versionStatus = getEntityFromUrl(req.originalUrl);
                            if (versionStatus !== 'main' && versionStatus !== 'delta') {
                                logger.error('somebody tried to connect to nonexistent page', attackerDetails(req));
                                res.sendStatus(404);
                            } else {

                                switch (true) {
                                    case (
                                        !req.headers
                                        || !req.headers['content-type']
                                        || !availableReqContentTypes.includes(String(req.headers['content-type']).split(';')[0])
                                        ):
                                            logger.error(`someone tied to upload file with incorrect content-type`, attackerDetails(req));
                                            res.sendStatus(422);
                                            break;

                                    case (
                                        !req.headers['content-length']
                                        || req.headers['content-length'] === ''
                                        || +(req.headers['content-length'] as string) > maxSize
                                        ):
                                            logger.error(`someone tried to upload very big file`, attackerDetails(req));
                                            res.sendStatus(413);
                                            break;

                                    default:
                                        req.on('close', () => {
                                            console.log('close!');
                                            // fs.unlink(path.join(process.cwd(), `static/files/fws/${ req.body.fwId }/main/${ req.files[0].originalname.replace(' ', '_') }`), (err) => {
                                            //     if (err) {
                                            //         console.log('err:');
                                            //         console.log(err);
                                            //         // err['additionalMessage'] = 'unfinished uploading file cleaninig failed';
                                            //         throw err;
                                            //         // throw new Error('unfinished uploading file cleaninig failed');
                                            //     }

                                            //     logger.error(`connection was failed. unfinished uploading file cleaned`);
                                            // });
                                        });

                                        uploadFw(req, res, error => {
                                            if (error) {
                                                switch (true) {
                                                    case (error.code === 'LIMIT_FILE_SIZE'):
                                                        logger.error(`someone tried to upload very big file`, attackerDetails(req));
                                                        res.sendStatus(413);
                                                        break;

                                                    case (error.message === '422'):
                                                        logger.error(`someone tied to upload file with incorrect extantion`, attackerDetails(req));
                                                        res.sendStatus(422);
                                                        break;

                                                    case (error.message === '406'):
                                                        logger.error(`someone tied to upload empty file`, attackerDetails(req));
                                                        res.sendStatus(406);
                                                        break;

                                                    case (error.message === '424'):
                                                        logger.error(`someone tied to upload file without reference to fw or with reference to nonexistent fw`, attackerDetails(req));
                                                        res.sendStatus(424);
                                                        break;

                                                    default:
                                                        logger.error(`new fw uploading failed (multer error)`, error);
                                                        res.sendStatus(500);
                                                }
                                            } else {
                                                if (req.files.length === 0 || !req.files[0].originalname) {
                                                    logger.error(`someone tied to upload empty file`, attackerDetails(req));
                                                    res.sendStatus(406);

                                                } else {
                                                    (async () => {
                                                        if (versionStatus === 'main') {
                                                            const updatedUrl = updateEntity({
                                                                fileUrl: `files/fws/${ req.body.fwId }/main/${ req.files[0].originalname.replace(' ', '_') }`,
                                                            });

                                                            await db.sqlEditRequest(`
                                                                UPDATE fws SET ${ updatedUrl } WHERE fwId="${ req.body.fwId }";
                                                            `);

                                                            logger.info(`new fw was uploaded to server: ${ req.files[0].originalname.replace(' ', '_') }`);
                                                            res.sendStatus(201);
                                                        } else {
                                                            const rows = await db.sqlGetRequest(`
                                                                SELECT deltas FROM fws WHERE fwId="${ req.body.fwId }";
                                                            `);

                                                            const deltas: {[key: string]: any} = decodeEntity(rows[0]);
                                                            if (deltas.deltas) {
                                                                deltas.deltas = JSON.parse(deltas.deltas as string);
                                                            }

                                                            if (deltas.deltas === null) {
                                                                deltas.deltas = [{
                                                                    fwId: req.body.fwId,
                                                                    version: req.body.deltaVersion,
                                                                    fileUrl: `files/fws/${ req.body.fwId }/delta/${ req.body.deltaVersion }/${ req.files[0].originalname.replace(' ', '_') }`,
                                                                    creationdate: new Date(),
                                                                }];
                                                            } else {

                                                                for (const item of deltas.deltas as Array<any>) {
                                                                    if (item.version === req.body.deltaVersion) {
                                                                        item.fileUrl = `files/fws/${ req.body.fwId }/delta/${ req.body.deltaVersion }/${ req.files[0].originalname.replace(' ', '_') }`;

                                                                        item.updatingdate = new Date();

                                                                        break;
                                                                    }
                                                                }
                                                            }

                                                            const stringifiedDeltas = JSON.stringify(deltas.deltas);

                                                            const updatedUrl = updateEntity({ deltas: stringifiedDeltas });

                                                            await db.sqlEditRequest(`
                                                                UPDATE fws SET ${ updatedUrl } WHERE fwId="${ req.body.fwId }";
                                                            `);

                                                            logger.info(`new fw delta was uploaded to server: ${ req.files[0].originalname.replace(' ', '_') }`);
                                                            res.sendStatus(201);
                                                        }
                                                    })();
                                                }
                                        }
                                    });
                                }
                            }
                        }
                    }
                } catch (error) {
                    logger.error('new fw uploading failed', error);
                    res.status(500).send(error);
                }
            }
        );

    }
}
