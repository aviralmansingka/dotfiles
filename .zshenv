alias gradlew="../../../gradlew"

export P1="mr83p01ad-hadoop051.iad.apple.com"
export ALT_P1="mr23p01ad-happ001.iad.apple.com"
export S1="mr23p01ad-hadoop351.iad.apple.com"
export S2="mr23p01ad-hadoop448.iad.apple.com"
export R2="mr11q01ad-lhadoop007.iad.apple.com"
export R4="mr11q01ad-lhadoop003.iad.apple.com"
export SPARK="mr11q01ad-lhadoop178.iad.apple.com"
export R4ST="mr11q01ad-lhadoop126.iad.apple.com"
export S1ST="st11p01ad-shadoop053.iad.apple.com"
export P1ST="st13p01ad-hadoop116.iad.apple.com"
export CASS="mr85p01ad-hadoop579.iad.apple.com"
export MDB="app-mzstore-data-builder"
export HIB="app-hadoop-index-builder"
export ASB="app-algo-stats-builder"
export TORO_HOME="/Users/aviral/toro"
export PARENT="$TORO_HOME/projects/serving"
export SS="$PARENT/app-sponsored-search"
export TEST_SERVICE="$PARENT/app-test-service"
export E2E_VERIFY="$PARENT/app-integration-verification"


function e2e-verification() {
  # Docs: https://wiki.iad.apple.com/confluence/display/toro/Run+E2E+locally
  cd $E2E_VERIFY
  gradlew tomcatDebug -Pconf=s1-mr11
  curl http://localhost:12010/e2e/1.0/test
  tail -f build/tomcat/12010/logs/iad-app.log
  popd
}

function ss() {
  kill-tomcat
  cd $SS
  gradlew tomcatDebug -Pconf=dev-ue1
  popd
}

function test-service() {
  kill-tomcat
  cd $TEST_SERVICE
  gradlew tomcatDebug -Pconf=dev-ue1
  popd
}

function aws-test-key() {
  RESULT=$(python3 ~/scripts/local/python/aws-keygen.py)
  echo $RESULT | pbcopy
}

function oracle() {
    ssh -f amansingka@st11a00is-bastion.isg.apple.com -C -L 2572:mr11p01ad-ssdwhdb01002.iad.apple.com:1526 -N
}

function notify() {
    terminal-notifier -title "iTerm2" -message $1
}

function build() {
    FOLDER="build/stage/lib"
    cd $PARENT/$APP
    echo "$PARENT/$APP"
    rm ~/.ssh/known_hosts
    gradlew build $@ \
        && scp $PARENT/$APP/build/libs/* $ENV:~/$APP/$FOLDER/java \
        && notify "Completed build of $APP to env $ENV"
    echo "sent to app $APP env $ENV"
    popd
}

function build-stage() {
    FOLDER="build/stage/lib"
    cd $PARENT/$APP
    echo "$PARENT/$APP"
    gradlew build stage $@ \
        && rm ~/.ssh/known_hosts \
        && scp $PARENT/$APP/$FOLDER/java/* $ENV:~/$APP/$FOLDER/java \
        && rm ~/.ssh/known_hosts \
        && scp $PARENT/$APP/$FOLDER/hadoop/* $ENV:~/$APP/$FOLDER/hadoop \
        && rm ~/.ssh/known_hosts \
        && scp $PARENT/$APP/src/main/conf/* $ENV:~/$APP/oozie \
        && notify "Completed stage build of $APP to env $ENV"
    echo "sent to app $APP env $ENV"
    popd
}

function build-oozie() {
    FOLDER="build/stage/lib"
    cd $PARENT/$APP
    echo "$PARENT/$APP"
    rm ~/.ssh/known_hosts
    scp $PARENT/$APP/src/main/conf/* $ENV:~/$APP/oozie \
    echo "sent to app $APP env $ENV"
    popd
}

function build-module() {
    FOLDER="build/stage/lib"
    cd $PARENT/$MODULE
    echo "$PARENT/$MODULE"
    rm ~/.ssh/known_hosts
    gradlew build $@ \
        && scp $PARENT/$MODULE/build/libs/$MODULE.jar $ENV:~/$APP/$FOLDER/java \
        && rm ~/.ssh/known_hosts \
        && scp $PARENT/$MODULE/build/libs/$MODULE.jar $ENV:~/$APP/$FOLDER/hadoop \
        && notify "Completed module build of $MODULE for $APP to env $ENV"
    echo "sent module $MODULE to $APP env $ENV"
    popd
}

function kill-tomcat() {
    jps | grep Bootstrap | cut -d ' ' -f 1 | xargs kill -9
}

function iad-scala() {
    env JAVA_OPTS="-Xms2048m -Xmx4096m" scala -classpath "/Users/aviral/toro/projects/serving/app-algo-stats-builder/build/stage/lib/java/*:/Users/aviral/toro/projects/serving/app-hadoop-index-builder/build/stage/lib/java/*:/Users/aviral/toro/projects/serving/app-sponsored-search/build/classes:/Users/aviral/toro/projects/serving/app-query-rewrite-service/build/classes"
}

function color() {
    curl -s https://r4-iad-ss-sponsored-search.iad.apple.com/adserver/configView.jsp | grep color
}

function d2() {
    python /Users/aviral/scripts/local/python/d2.py "$@"
}

function mount-oozie() {
    sshfs amansingka@$1:/Users/amansingka/app-algo-stats-builder/main/conf ~/toro/projects/serving/app-algo-stats-builder/src/main/conf -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
    sshfs amansingka@$1:/Users/amansingka/app-hadoop-index-builder/main/conf ~/toro/projects/serving/app-hadoop-index-builder/src/main/conf -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
    sshfs amansingka@$1:/Users/amansingka/app-mzstore-data-builder/main/conf ~/toro/projects/serving/app-mzstore-data-builder/src/main/conf -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
}

function mount-scripts() {
    sshfs amansingka@$1:/Users/amansingka/scripts ~/scripts -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
}

function unmount-scripts() {
    sudo umount -f ~/scripts
}

function mount-jars() {
    sshfs amansingka@$1:/Users/amansingka/app-algo-stats-builder/build/libs ~/toro/projects/serving/app-algo-stats-builder/build/libs -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
    sshfs amansingka@$1:/Users/amansingka/app-algo-stats-builder/build/stage/lib/java ~/toro/projects/serving/app-algo-stats-builder/build/stage/lib/java -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
    sshfs amansingka@$1:/Users/amansingka/app-algo-stats-builder/build/stage/lib/hadoop ~/toro/projects/serving/app-algo-stats-builder/build/stage/lib/hadoop -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename

    sshfs amansingka@$1:/Users/amansingka/app-hadoop-index-builder/build/libs ~/toro/projects/serving/app-hadoop-index-builder/build/libs -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
    sshfs amansingka@$1:/Users/amansingka/app-hadoop-index-builder/build/stage/lib/java ~/toro/projects/serving/app-hadoop-index-builder/build/stage/lib/java -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
    sshfs amansingka@$1:/Users/amansingka/app-hadoop-index-builder/build/stage/lib/hadoop ~/toro/projects/serving/app-hadoop-index-builder/build/stage/lib/hadoop -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename

    sshfs amansingka@$1:/Users/amansingka/app-mzstore-data-builder/build/libs ~/toro/projects/serving/app-mzstore-data-builder/build/libs -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
    sshfs amansingka@$1:/Users/amansingka/app-mzstore-data-builder/build/stage/lib/java ~/toro/projects/serving/app-mzstore-data-builder/build/stage/lib/java -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
    sshfs amansingka@$1:/Users/amansingka/app-mzstore-data-builder/build/stage/lib/hadoop ~/toro/projects/serving/app-mzstore-data-builder/build/stage/lib/hadoop -o auto_cache,reconnect,defer_permissions,noappledouble,workaround=rename
}

function unmount-oozie() {
    sudo umount -f ~/toro/projects/serving/app-algo-stats-builder/src/main/conf
    sudo umount -f ~/toro/projects/serving/app-hadoop-index-builder/src/main/conf
    sudo umount -f ~/toro/projects/serving/app-mzstore-data-builder/src/main/conf
}

function unmount-jars() {
    sudo umount -f ~/toro/projects/serving/app-algo-stats-builder/build/libs
    sudo umount -f ~/toro/projects/serving/app-algo-stats-builder/build/stage/lib/java
    sudo umount -f ~/toro/projects/serving/app-algo-stats-builder/build/stage/lib/hadoop

    sudo umount -f ~/toro/projects/serving/app-hadoop-index-builder/build/libs
    sudo umount -f ~/toro/projects/serving/app-hadoop-index-builder/build/stage/lib/java
    sudo umount -f ~/toro/projects/serving/app-hadoop-index-builder/build/stage/lib/hadoop

    sudo umount -f ~/toro/projects/serving/app-mzstore-data-builder/build/libs
    sudo umount -f ~/toro/projects/serving/app-mzstore-data-builder/build/stage/lib/java
    sudo umount -f ~/toro/projects/serving/app-mzstore-data-builder/build/stage/lib/hadoop
}

function r4() {
    rm ~/.ssh/known_hosts
    ssh $R4
}

function spark() {
    rm ~/.ssh/known_hosts
    ssh $SPARK
}

function r2() {
    rm ~/.ssh/known_hosts
    ssh $R2
}

function s1() {
    rm ~/.ssh/known_hosts
    ssh $S1
}

function s2() {
    rm ~/.ssh/known_hosts
    ssh $S2
}

function p1() {
    rm ~/.ssh/known_hosts
    ssh $P1
}

function cass() {
    rm ~/.ssh/known_hosts
    ssh $CASS
}

function r4-st() {
    rm ~/.ssh/known_hosts
    ssh $R4ST
}

function s1-st() {
    rm ~/.ssh/known_hosts
    ssh $S1ST
}

function p1-st() {
    rm ~/.ssh/known_hosts
    ssh $P1ST
}

function app-sponsored-search() {
  /Library/Java/JavaVirtualMachines/jdk1.8.0_171.jdk/Contents/Home/bin/java -Djava.util.logging.config.file=/Users/aviral/toro/projects/serving/app-sponsored-search/build/tomcat/10700/conf/logging.properties -Djava.util.logging.manager=org.apache.juli.ClassLoaderLogManager -Djdk.tls.ephemeralDHKeySize=2048 -Djava.protocol.handler.pkgs=org.apache.catalina.webresources -agentlib:jdwp=transport=dt_socket,address=localhost:20701,server=y,suspend=n -Xloggc:/Users/aviral/toro/projects/serving/app-sponsored-search/build/tomcat/10700/logs/jvm-gc.log -verbose:gc -XX:+PrintGCDateStamps -Xmx15g -Xms8g -XX:ThreadStackSize=512 -XX:-HeapDumpOnOutOfMemoryError -Dcom.apple.iad.cacheserver.address=localhost:10740 -DcacheBuilderVersion=v1602 -DCONFIG_TYPE=CONFIG_SERVICE -DBACKED_TYPE=AWS -DENV=dev -DDC=ue1 -Dapp.context=/adserver -Duser.timezone=UTC -Dfile.encoding=UTF-8 -classpath /Users/aviral/toro/projects/serving/app-sponsored-search/build/tomcat/10700/bin/bootstrap.jar:/Users/aviral/toro/projects/serving/app-sponsored-search/build/tomcat/10700/bin/tomcat-juli.jar -Dcatalina.base=/Users/aviral/toro/projects/serving/app-sponsored-search/build/tomcat/10700 -Dcatalina.home=/Users/aviral/toro/projects/serving/app-sponsored-search/build/tomcat/10700 -Djava.io.tmpdir=/Users/aviral/toro/projects/serving/app-sponsored-search/build/tomcat/10700/temp org.apache.catalina.startup.Bootstrap start
}

function app-test-service() {
    /Library/Java/JavaVirtualMachines/jdk1.8.0_171.jdk/Contents/Home/bin/java -Djava.util.logging.config.file=/Users/aviral/toro/projects/serving/app-test-service/build/tomcat/10790/conf/logging.properties -Djava.util.logging.manager=org.apache.juli.ClassLoaderLogManager -Djdk.tls.ephemeralDHKeySize=2048 -Djava.protocol.handler.pkgs=org.apache.catalina.webresources -agentlib:jdwp=transport=dt_socket,address=20791,server=y,suspend=n -Xmx4096m -Xms2048m -XX:ThreadStackSize=512 -XX:-HeapDumpOnOutOfMemoryError -Dapp.context=/test -Duser.timezone=UTC -Dfile.encoding=UTF-8 -classpath /Users/aviral/toro/projects/serving/app-test-service/build/tomcat/10790/bin/bootstrap.jar:/Users/aviral/toro/projects/serving/app-test-service/build/tomcat/10790/bin/tomcat-juli.jar -Dcatalina.base=/Users/aviral/toro/projects/serving/app-test-service/build/tomcat/10790 -Dcatalina.home=/Users/aviral/toro/projects/serving/app-test-service/build/tomcat/10790 -Djava.io.tmpdir=/Users/aviral/toro/projects/serving/app-test-service/build/tomcat/10790/temp org.apache.catalina.startup.Bootstrap start
}

function serving() {
    cd
    cd toro/projects/serving
}

function build-tags-java() {
    find . -name "*.java" -print | xargs etags --append
}

function build-tags-py() {
    find . -name "*.py" -print | xargs etags --append
}

function build-tags-js() {
    find . -name "*.js" -print | xargs etags --append
}

function build-tags-cpp() {
    find . -name "*.cpp" -print -or -name "*.h" -print | xargs etags --append
}

