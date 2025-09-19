<p align="center">
  <a href="https://github.com/rokeller/infomaniak-uploader/actions"><img alt="typescript-action status" src="https://github.com/rokeller/infomaniak-uploader/workflows/build-test/badge.svg"></a>
  <a href="https://github.com/rokeller/infomaniak-uploader/actions"><img alt="typescript-action status" src="https://github.com/rokeller/infomaniak-uploader/workflows/Check dist%2f/badge.svg"></a>
  <a href="https://github.com/rokeller/infomaniak-uploader/actions"><img alt="typescript-action status" src="https://github.com/rokeller/infomaniak-uploader/workflows/CodeQL/badge.svg"></a>
<p>
<p align="center">
  <img alt="GitHub last commit" src="https://img.shields.io/github/last-commit/rokeller/infomaniak-uploader">
  <img alt="GitHub issues" src="https://img.shields.io/github/issues-raw/rokeller/infomaniak-uploader">
  <img alt="GitHub pull requests" src="https://img.shields.io/github/issues-pr-raw/rokeller/infomaniak-uploader">
  <img alt="GitHub commit activity" src="https://img.shields.io/github/commit-activity/y/rokeller/infomaniak-uploader">
  <img alt="GitHub" src="https://img.shields.io/github/license/rokeller/infomaniak-uploader">
</p>

# Upload files to Infomaniak-hosted FTP servers

This action lets you upload files to Infomaniak-hosted FTP servers securely,
even if SFTP and SSH for the server are not available. That applies for instance
to the free _Starter_ web hosting offer from Infomaniak. At the same time,
Infomaniak offers their [FTP Manager](https://manager.infomaniak.com/ftp/) to
upload files securely over HTTPS. This action uses the APIs offered by the FTP
Manager to upload files from GitHub workflows.

## Usage

```yaml
- uses: rokeller/infomaniak-uploader@v2
  with:
    # (Required) The domain name of the FTP server for which to upload the files.
    ftpServer: 'my-domain.com'

    # (Required) The user name of the FTP user to use for login.
    ftpUser: 'my-user'

    # (Required) The password of the FTP user to use for login.
    ftpPassword: ${{ secrets.FTP_PASSWORD }}

    # (Required) The path to a local folder containing the files and sub-folders
    #            to be uploaded. All files and folders from this folder will
    #            be uploaded and the structure is kept. Files that already exist
    #            on the server will be overwritten. Files that exist on the
    #            server but do not exist locally will *not* be touched.
    localRoot: path/to/local/root

    # (Optional) The path on the FTP server to upload to. Defaults to '/'
    remoteRoot: '/about'

    # (Optional) The set of paths to directories (from the remote root) to clean
    #            up if and only if the directory had any files uploaded. Use one
    #            line per directory.
    #            This can be particularly useful e.g. for assets directories with
    #            asset files being generated during build time using hashes, like
    #            'index-DSUpa6hk.js' or 'index-IWvhMyfN.css'. These old files,
    #            if not periodically removed, accumulate and will likely never
    #            be used anymore.
    cleanupDirs: |-
      /path/to/directory/to/cleanup
      /path/to/another/directory
```

**Important**: Uploading files with > 2 000 000 byte is not currently supported.
