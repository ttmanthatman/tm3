// Chat attachments stream directly to storage, so the application must not
// reject large files before Nginx or the storage layer has a chance to handle them.
export const multipartUploadOptions = {
  limits: {
    fileSize: Number.POSITIVE_INFINITY,
    files: 1
  }
};
