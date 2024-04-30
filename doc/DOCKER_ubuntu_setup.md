# Installation and Upgrade of Dojo on Ubuntu 16

This procedure is written for the installation of MyDojo on a host machine running Ubuntu 16 but it should be easy to adapt it for Linux distributions running on a x86-64 architecture.


## Table of Content ##

- [Requirements](#requirements)
- [Storage locations](#storage)
- [Installation procedure](#install)
- [Upgrade procedure](#upgrade)


<a name="requirements"/>

## 1/ Requirements ##

The main requirements for the host machine running MyDojo are:

* Processor: x86-64
* OS: Linux 64 bits
* Disk Type: SSD (recommended)
* Disk Size: 600GB (min)/ 1TB (recommended)
* RAM: 2GB (min) / 4GB (recommended)

__Additional Considerations__

* While MyDojo will work fine on a multipurpose computer, a dedicated host machine connected 24/7 to the network is recommended. MyDojo was primarily designed as a server always ready for use
* The clock of the host machine MUST be set properly (required for Tor)


<a name="storage"/>

## 2/ Storage Locations ##

By default, MyDojo stores its code and data in 2 different locations:

* __MyDojo application code__: source code of MyDojo + Dojo Shell Script + Configuration files

* __MyDojo and Docker data__:  persistent data required for a functional MyDojo (blockchain data, Dojo database, logs, Docker images)

By default, MyDojo and Docker data will be stored under `/var/lib/docker` directory but the directory can be modified (e.g.: all data stored on an dedicated disk).


<a name="install"/>

## 3/ First Installation

The procedure described in this section will configure and install MyDojo with its own Indexer for fast rescans.

### 3.1/ Prepare Host System

First, we must prepare our host system for MyDojo by installing required operating system dependencies and configuring our linux system with privacy and security in mind.

#### 3.1.1/ Install OS dependencies

```sh
> cd ~
> sudo apt-get update
> sudo apt-get install apt-transport-https ca-certificates curl gnupg-agent software-properties-common unzip
```

#### 3.1.2/ Install Docker & Docker-Compose

Follow the [official insctruction manual](https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository) on the Docker documentation site.

__Create a user account for MyDojo__

Creating a segregated user account for MyDojo is a good idea for security reasons.


#### 3.1.3/ Create a dojo user

```sh
> sudo useradd -s /bin/bash -d /home/dojo -m -G sudo dojo
> sudo passwd dojo
```

Enter and confirm the password for the `dojo` user.

__Add the user to the docker group__

```sh
> sudo usermod -aG docker dojo
```

__Restart Host System__

```sh
> sudo shutdown -r now
```

Log back into the Host System with the `dojo` user and test the Docker installation

```sh
> docker run hello-world
```

This command should display a hello message if Docker can be run with the `dojo` user.


#### 3.1.4/ Configure Docker data storage directory (optional)

This step should be applied if you don't want to store MyDojo and Docker data under the default `/var/lib/docker` directory (e.g.: all data will be stored on an external SSD).

__Stop the Docker Service__

```sh
> sudo systemctl stop docker
```

Create the directory that will store Docker data (replace `/path/to/target/directory/` by the correct path).

```sh
> sudo mkdir /path/to/target/directory/
```

Temporarily switch to root and create the daemon.json file storing the path to your Docker direct (replace `/path/to/target/directory/` by the correct path).

```sh
> sudo su - root
> sudo echo '{ "data-root": "/path/to/target/directory/" }' > /etc/docker/daemon.json
> exit
```


### 3.2/ Downloading MyDojo

Now that the Host System has been prepared, we will download the latest version of MyDojo source code and configure it before proceeding with install.


#### 3.2.1/ Initialize the dojo app directory

We first create a directory for housing our MyDojo files. In this guide we are naming this directory `dojo-app` and it will be located in the home directory of the `dojo` user.

```sh
> mkdir ~/dojo-app
```

#### 3.2.2/ Download latest MyDojo files

Download and unpack the source archive for the latest version of MyDojo and copy these files to the newly created `dojo-app` directory with the following commands.

```sh
> cd ~
> wget https://code.samourai.io/dojo/samourai-dojo/-/archive/master/samourai-dojo-master.zip
> unzip samourai-dojo-master.zip -d .
> cp -a samourai-dojo-master/. dojo-app/
```

Delete the source archive now that we have copied the files to our directory.

```sh
> rm -rf samourai-dojo-master
> rm samourai-dojo-master.zip
```


### 3.3/ Configuring MyDojo

Change the working directory to the MyDojo configuration directory.

```sh
> cd ~/dojo-app/docker/my-dojo/conf
```

__Note:__

You will be required to generate various random alphanumeric passwords to secure various aspects of your Dojo installation. You can generate these in any way you wish, but you may wish to use the following command in a terminal session to generate these passwords with sufficient entropy:

```sh
> cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 64 | head -n 1
```

#### 3.3.1/ Bitcoin configuration

Edit the `docker-bitcoind.conf.tpl` file.

```sh
> nano docker-bitcoind.conf.tpl
```

Customize the content of the file

```sh
BITCOIND_RPC_USER=<provide_this_value>
BITCOIND_RPC_PASSWORD=<provide_this_value>
```

__Note:__

If your machine has a lot of RAM, it's recommended that you increase the value of `BITCOIND_DB_CACHE` (e.g 2048) for a faster Initial Block Download.

Save and exit the file with `CTRL+X`, `Y` and `ENTER`.


#### 3.3.2/ Database configuration

Edit the ``docker-mysql.conf.tpl`` file.

```sh
> nano docker-mysql.conf.tpl
```

Customize the content of the file

```sh
MYSQL_ROOT_PASSWORD=<provide_this_value>
MYSQL_USER=<provide_this_value>
MYSQL_PASSWORD=<provide_this_value>
```

Save and exit the file with `CTRL+X`, `Y` and `ENTER`.


#### 3.3.3/ NodeJS configuration

Edit the `docker-node.conf.tpl` file.

```sh
> nano docker-node.conf.tpl
```

Customize the content of the file

```sh
NODE_API_KEY=<provide_this_value>
NODE_ADMIN_KEY=<provide_this_value>
NODE_JWT_SECRET=<provide_this_value>
NODE_ACTIVE_INDEXER=local_indexer
```

Save and exit the file with `CTRL+X`, `Y` and `ENTER`.


#### 3.3.4/ Indexer configuration

Edit the `docker-indexer.conf.tpl` file.

```sh
> nano docker-indexer.conf.tpl
```

Customize the content of the file

```sh
INDEXER_INSTALL=on
```

Save and exit the file with `CTRL+X`, `Y` and `ENTER`.


### 3.6/ Execute the first installation of MyDojo

From this point on the install process is automatic. Launch the installation of MyDojo

```sh
> cd ~/dojo-app/docker/my-dojo
> ./dojo.sh install
```

Confirm the installation with `Y` and `ENTER`.


#### 3.6.1/ Understanding the Automatic Install

At this point, your job is done. The Dojo Shell script and Docker are going to take over and a lot of things are going to happen automatically.

__Building of MyDojo containers__

First, the shell script is going to initialize a set of configuration files. Then Docker is going to
initialize the dedicated networks and data volumes that will be used by MyDojo. At last, Docker is going
to build the Docker containers composing MyDojo.

This latest operation may last from a dozen to a few tens of minutes, depending on the specs of the hardware. A lot of logs are displayed and you may be concerned that some of these logs (displayed in red) are the sign of a problem. Don't worry about this. Some of these logs are just informational or warnings. Just be aware that if a blocking error occurs, Docker will stop building the containers and you won't reach the next phase.

__First launch of MyDojo__

If all Docker containers have been successfully built, the Shell Script is going to launch MyDojo (equivalent of the `dojo.sh start` command) and display its logs.

Here you may be able to observe a few things in the logs:

* The schema of the local database is initialized (done once during first installation)
* The Tor container is connecting to the Tor network
* Dojo application modules are started in the NodeJS container
* The Bitcoin daemon is launched, establishes connections to remote full nodes and starts to download block headers.
* The indexer is launched and waits for the completion of the Initial Blocks Download by the Bitcoin daemon.

__Initial Blocks Download__

When all blocks headers have been successfully downloaded and processed, the Bitcoin daemon is going to process its Initial Blocks Download (IBD). In parallel, the `Tracker` module of Dojo is going to process its own IBD thanks to data provided by the Bitcoin daemon.

This phase is going to last from 1 to several days, depending on the specs of the hardware. At this point, all you have to do is wait. The Bitcoin daemon is processing the IBD while the Tracker is importing block headers in parallel.

Note: You can exit the logs with `CTRL+C`. Don't worry, MyDojo is still running in background.

__Address Indexing__

When the Bitcoin daemon has completed its IBD, the Indexer will automatically start the indexation of all Bitcoin addresses. When the indexation is complete, it will compact the database.

These operations should last a few more hours, depending on the specs of the hardware.

Note: You may notice errors returned by the Block Explorer during all these operations. Don't worry. The Block Explorer should be available as soon as the Indexer has completed its tasks.


### 3.7/ Monitor Install Progress with the Maintenance Tool (DMT)

Retrieve the onion address of the DMT with the commands

```sh
> cd ~/dojo-app/docker/my-dojo
> ./dojo.sh onion
```

Open the DMT with the Tor browser and check the `Status` page.

If a green check is displayed for all modules and if the chaintip displayed for all modules match with the chaintip displayed by a third-party Block Explorer, then your Dojo is ready.



<a name="upgrade"/>

## 4/ Upgrade

The procedures described in this section will upgrade your Dojo to the most recent version or to a specific version of Dojo.


### 4.1/ Upgrade to latest version

This procedure allows to upgrade MyDojo to the latest version.

#### 4.1.1/ Stop MyDojo

```sh
> cd ~/dojo-app/docker/my-dojo
> ./dojo.sh stop
```

#### 4.1.2/ Update the code of MyDojo

Download the archive of latest version

```sh
> cd ~
> wget https://code.samourai.io/dojo/samourai-dojo/-/archive/master/samourai-dojo-master.zip
```

Uncompress the archive

```sh
> unzip samourai-dojo-master.zip -d .
```

Overwrite the dojo-app directory with the content of the archive

```sh
> cp -a samourai-dojo-master/. dojo-app/
```

#### 4.1.3/ Update Configuration (optional)

Check the [release notes](https://code.samourai.io/dojo/samourai-dojo/-/blob/master/RELEASES.md) of the new vesion for a list of new features that may require to tune the value of new configuration options.

If applicable, edit the templates files stored in `~/dojo-app/docker/my-dojo/conf/` and modify the values set for new configuration options.


#### 4.1.4/ Start Upgrade

```sh
> cd ~/dojo-app/docker/my-dojo
> ./dojo.sh upgrade
```

Confirm that you want to upgrade MyDojo with `Y` and `ENTER`.

The shell script is going to rebuild the Docker containers. MyDojo will be automatically restarted after the containers have been rebuilt.


#### 4.1.5/ Cleanup

```sh
> cd ~
> rm -rf samourai-dojo-master
> rm samourai-dojo-master.zip
```


### 4.2/ Upgrade to a specific version

This procedure allows to upgrade MyDojo to a specific version `X.Y.Z`

#### 4.2.1/ Stop MyDojo

```sh
> cd ~/dojo-app/docker/my-dojo
> ./dojo.sh stop
```

#### 4.2.2/ Update the code of MyDojo

Download the archive of version `X.Y.Z`

```sh
> cd ~
> wget https://code.samourai.io/dojo/samourai-dojo/-/archive/vX.Y.Z/samourai-dojo-vX.Y.Z.zip
```

Uncompress the archive

```sh
> unzip samourai-dojo-vX.Y.Z.zip -d .
```

Overwrite the dojo-app directory with the content of the archive

```sh
> cp -a samourai-dojo-vX.Y.Z/. dojo-app/
```

#### 4.2.3/ Update Configuration (optional)

Check the [release notes](https://code.samourai.io/dojo/samourai-dojo/-/blob/master/RELEASES.md) for a list of new features that may require to tune the value of new configuration options.

If applicable, edit the templates files stored in `~/dojo-app/docker/my-dojo/conf/` and modify the values set for new configuration options.


#### 4.2.4/ Start Upgrade

```sh
> cd ~/dojo-app/docker/my-dojo
> ./dojo.sh upgrade
```

Confirm that you want to upgrade MyDojo with `Y` and `ENTER`.

The shell script is going to rebuild the Docker containers. MyDojo will be automatically restarted after the containers have been rebuilt.


#### 4.2.5/ Cleanup

```sh
> cd ~
> rm -rf samourai-dojo-vX.Y.Z
> rm samourai-dojo-vX.Y.Z.zip
```
