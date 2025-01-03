# Copying data from an existing node

It's possible to copy the blockchain and Fulcrum data from an older node to your dojo, significantly speeding up the initial synchronization by taking
a few hours instead of days.  

Here are the steps:

## 1. Copy data from the old node

If you haven't copied the data already, make sure you stop `bitcoind` and `Fulcrum` before starting, otherwise you'll get corrupted indexes.

### Bitcoin

Copy the directories `blocks`, `indexes` and `chainstate`.

### Fulcrum

Copy the whole database directory, which contains:

```bash
blkinfo  headers  meta  rpa  scripthash_history  scripthash_unspent  txhash2txnum  txnum2txhash  undo  utxoset
```

## 2. Stop Dojo

If you already Dojo have installed and running, stop it with `./dojo.sh stop`. If it's not installed yet, proceed with a normal installation and,
as soon as you start seeing bitcoind-related output, like headers or blocks being downloaded, exit the log with `Ctrl + C` and then stop dojo.

## 3. Find Dojo data location

List docker volumes with `docker volume ls`:

```bash
DRIVER    VOLUME NAME
local     my-dojo_data-bitcoind
local     my-dojo_data-fulcrum
local     my-dojo_data-mysql
local     my-dojo_data-tor
```

Then check the mountpoint with `docker inspect my-dojo_data-bitcoind`. Look for a line like:

```bash
"Mountpoint": "/var/lib/docker/volumes/my-dojo_data-bitcoind/_data",
```

Take note of the directory and do the same for the Fulcrum mountpoint.

## 4. Delete current data

Become root to be able to go inside the directory. Depending on the Linux distro, this could be `sudo -i` or `su`. The prompt will change from `$` to `#`.  

### Bitcoin

Go inside the directory and check its contents:

```bash
cd /var/lib/docker/volumes/my-dojo_data-bitcoind/_data
ls -l

drwx------ 3 1105 1108 264K Dec 22 07:50 blocks
drwx------ 2 1105 1108 240K Dec 22 07:50 chainstate
-rw------- 1 1105 1108  16M Dec 22 13:53 debug.log
-rw------- 1 1105 1108 243K Dec 22 13:24 fee_estimates.dat
drwx------ 4 1105 1108 4.0K Jul 11  2022 indexes
(some lines ommited)
```

Take note of the user id (UID) of the owner `1105` and the group (GID) `1108` if you got different values.  

Delete the blockchain data with `rm -rf blocks indexes chainstate`. The other files can be ignored.

### Fulcrum

Just like Bitcoin, except the data is under a hidden `.fulcrum` directory:

```bash
cd /var/lib/docker/volumes/my-dojo_data-fulcrum/_data/.fulcrum/db
ls -l

drwxr-xr-x 2 1133 1136        4096 Dec 10 18:24 blkinfo
-rw-r--r-- 1 1133 1136    70072652 Dec 22 13:56 headers
drwxr-xr-x 2 1133 1136        4096 Dec 21 06:08 meta
drwxr-xr-x 2 1133 1136        4096 Dec 10 18:24 rpa
(some lines ommited)
```

The ids in this case are `1133` and `1136`. Delete everything there with `rm -rf *`.

## 5. Copy the data

You now have to copy the files any way you want, like using the GUI or the terminal, and then adjust their ownership and permissions. If using the terminal, `rsync` is a good option because it displays progress and makes it easier if you need to stop the copying process and resume later, but `cp` can be used too.

The following commands assume data is being copied from an external USB HDD mounted at `/mnt/externalusb`, which has a `bitcoin` and a `fulcrum` folder with the data you previously copied to it.  
  
> Note: if using rsync, pay attention to the commands below, specially if you're using TAB completion. In rsync syntax, `blocks` means the directory itself whereas `blocks/` means the directory contents!

### Bitcoin

Make sure you're inside the bitcoin directory - the one you deleted `blocks`, `indexes` and `chainstate` from - and run:

`rsync -az --progress /mnt/externalusb/bitcoin/{blocks,indexes,chainstate} ./`

There will be many lines like:

```bash
sending incremental file list                                                                                          
blocks/                                                                                                                
blocks/blk00000.dat                                                                                                    
    134,168,169 100%   36.34MB/s    0:00:03 (xfr#1, to-chk=7185/7189)
blocks/blk00001.dat                                                                                                    
    134,112,620 100%   35.15MB/s    0:00:03 (xfr#2, to-chk=7184/7189)                                                    
blocks/blk00002.dat
```

Indicating it's copying file 7185, then 7184 of 7189. This might take a few hours. If you need to stop with `Ctrl + C`, re-issuing the `rsync` command will resume copying the missing files.  
When it's over, adjust ownership and permissions as they were before (change UID and GID if needed):

```bash
chown -R 1105:1108 {blocks,chainstate,indexes}
chmod -R 600 {blocks,chainstate,indexes}
find {blocks,chainstate,indexes} -type d -print0 | xargs -0 chmod u+x
```

### Fulcrum

Go to `.fulcrum/db`, copy the files and adjust permissions and ownership (again, mind the slashes and ids):

```bash
rsync -az --progress /mnt/externalusb/fulcrum/ ./
chown -R 1133:1136 .
chmod -R 644 .
find . -type d -print0 | xargs -0 chmod 755
```

Then exit the root prompt with `exit` or `Ctrl + D`.

## 6 Restart Dojo

Restart Dojo with `./dojo.sh start` and check the logs with `./dojo logs`. You should see Bitcoin and Fulcrum logs resuming from the same point the older node was.
