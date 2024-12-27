#!/usr/bin/env bash
#
# zip.sh
#
# Creates anthony.ettinger.zip from all anthony.ettinger.* files

FILES="anthony.ettinger.*"
ZIPFILE="anthony.ettinger.zip"

echo "Zipping all matching files: $FILES"
zip -r "$ZIPFILE" $FILES
unzip -l "$ZIPFILE"

if [[ $? -eq 0 ]]; then
  echo "Successfully created $ZIPFILE"
else
  echo "Error: Failed to create $ZIPFILE"
  exit 1
fi

