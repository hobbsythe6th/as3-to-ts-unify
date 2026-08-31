const fs = require('fs-extra');
const path = require('path');

function getLockFile (directory: string) {
    return path.join(directory, ".as3-to-typescript_sentinel.txt");
}

export function getLockTimestamp (directory: string): Date {
    let lockfile = getLockFile( directory );
    let timestamp = new Date();

    if (fs.existsSync(lockfile)) {
        let stat = fs.statSync(lockfile);
        timestamp = stat.atime;
    }

    return timestamp
}

export function updateLockTimestamp (directory: string, timestamp: number) {
    let lockfile = getLockFile( directory );

    if (!fs.existsSync(lockfile)) {
        fs.outputFileSync(
            lockfile,
            `This file exists to keep track of the timestamp of when as3-to-typescript was last run,
            to make it possible to detect when files have been manually changed since that last run,
            to make it possible to avoid overwriting such files (which is a feature that can be enabled)`.replace(/^\s*/gm, '') // remove leading indentation from each line of string literal
        );
    }

    fs.utimesSync(lockfile, timestamp, timestamp);
}
