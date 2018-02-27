init();
function init(){
    createDownloadButtons()
    zip.useWebWorkers = false;
    function createDownloadButtons(){
        var downloadLink = document.createElement('a');
        downloadLink.id = 'downloadLink';
        document.body.appendChild(downloadLink);
        
            createButtonForElements(document.querySelectorAll('.book-header-tools'));       
            createButtonForElements(document.querySelectorAll('#readbook-form'));
            createButtonForElements(document.querySelectorAll('.book'), 0);
            
        function createDownloadButton(bottomPosition){
            var downloadButton = document.createElement('div');
            var downloadImgURL = chrome.extension.getURL('img/download.png');
            downloadButton.classList.add('downloadBook');
            downloadButton.style.position = 'absolute';
            if (bottomPosition == 0) downloadButton.style.bottom = '0px';
            downloadButton.style.zIndex = '4';
            downloadButton.style.cursor = 'pointer';
            downloadButton.innerHTML = '<img class="downloadBook" src=' + downloadImgURL + '>';
            return downloadButton;
        }
        function createButtonForElements(elements, bottomPosition){
            for (var i = 0; i <elements.length; i++){
                var book = elements[i];
                if(!book.querySelector('a') && !book.id == 'readbook-form') continue;
                book.appendChild(createDownloadButton(bottomPosition));
            }
        }
        document.body.addEventListener('click', handleDownloadClick, false);
       
    }

    function handleDownloadClick(e){
        if (!e.target.classList.contains('downloadBook')) return;
        var bookURL
        if (e.target.closest('#readbook-form')){
            bookURL = document.querySelector('#readbook-form').getAttribute('action');
        } else {
            bookURL = e.target.parentNode.parentNode.closest('div').querySelector('a').href;
        }
        
        bookURL = bookURL.replace('//m.', '//').replace('reader/', '');
        console.log(bookURL);
        downloadBook(bookURL,  e.target);        
    }


    
    function downloadBook(bookURL, target){
        var imgURL = chrome.extension.getURL('img/ajax-loader.gif').replace('ajax-loader.gif', '');
        target.src = imgURL + 'ajax-loader.gif';
        var readerArgs;
        var containerXML;
        var contentOPF = {
            path: null
        }
        var itemsArray = [];
        httpGet(bookURL + 'reader/?')
        .then(
            data =>{
                var regExp = /window\.readerArgs = \{.*\}/ig;
                readerArgs =  JSON.parse(regExp.exec(data.response)[0].replace('window\.readerArgs = ', ''));
                return httpGet("https://mybook.ru" + readerArgs.prefix + 'META-INF/container.xml')
            }
        )
        .then(
            data => {
                containerXML = data.response;
                var parser = new DOMParser();
                var xmlDoc = parser.parseFromString(data.response, "text/xml");
                var contentURL = xmlDoc.getElementsByTagName('rootfile')[0].getAttribute('full-path');
                contentOPF.path = contentURL;
                console.log("https://mybook.ru" + readerArgs.prefix + contentURL);
                return httpGet("https://mybook.ru" + readerArgs.prefix + contentURL)
            }
        )
        .then(
            data => {
                contentOPF.data = data.response;
                var parser = new DOMParser();
                var xmlDoc = parser.parseFromString(data.response, "text/xml");
                var items = xmlDoc.getElementsByTagName('item');
                for (var i =0; i < items.length; i++ ){
                    itemsArray.push(items[i].getAttribute('href'));
                }
                
                return Promise.all( 
                    itemsArray.map(
                        item => httpGet('https://mybook.ru' + readerArgs.prefix + contentOPF.path.replace('content.opf', '') + item, item.slice(-3))
                    ) 
                )                
            }
        )
        .then(
            data => {
                var files = data.map(item => {
                    var file = {};
                    if (item.img){
                        file.blob = item.img
                    } else {                        
                        file.text = item.responseText
                    }
                    file.name = item.responseURL.replace('https://mybook.ru' + readerArgs.prefix, '');
                    return file;
                });
                files.push({
                    text: containerXML,
                    name: 'META-INF/container.xml'
                },{
                    text: contentOPF.data,
                    name: contentOPF.path
                },{
                    text: 'application/epub+zip',
                    name: 'mimetype'
                });
                console.log('start ZIPPING');
                target.src = imgURL + 'zip.gif';
                epubZip.addFiles(files, function() { }, 
                        function() {                       
                        }, function(current, total) {
                            console.log(current + '/' + total);
                        }, function() {
                            epubZip.getBlobURL(function(blobURL) {
                                var downloadButton = document.getElementById('downloadLink');
                                var clickEvent;
                                clickEvent = document.createEvent("MouseEvent");
                                clickEvent.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
                                downloadButton.href = blobURL;
                                downloadButton.download = readerArgs.name + '.epub';
                                downloadButton.dispatchEvent(clickEvent);
                                target.src = imgURL + 'down-arrow.png';
                            });
                    }
                );
            }
        )
        .catch(error => {
            console.error(error); 
        }); 
    }   
    
    //HTTP METHOD 

    function httpGet(url, fileType) {
        return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        if (fileType == 'jpg' || fileType == 'png') xhr.responseType = 'arraybuffer';
        xhr.onload = function() {
            if (this.status == 200) {
                if (fileType == 'jpg' || fileType == 'png'){
                    var uInt8Array = new Uint8Array(this.response);
                    var i = uInt8Array.length;
                    var binaryString = new Array(i);
                    while (i--)
                    {
                      binaryString[i] = String.fromCharCode(uInt8Array[i]);
                    }
                    var data = binaryString.join('');
                
                    var base64 = window.btoa(data);
                    resolve({
                        responseURL: this.responseURL,
                        img: "data:image/" + fileType + ";base64," + base64
                    });
                } else {
                    resolve(this);
                }
            

            } else {
            var error = new Error(this.statusText);
            error.code = this.status;
            reject(error);
            }
        };
        xhr.onerror = function() {
            reject(new Error("Network Error"));
        };
        xhr.send();
        });

    }
    //ZIP METHODS
    var obj = window;
    var requestFileSystem = obj.webkitRequestFileSystem || obj.mozRequestFileSystem || obj.requestFileSystem;

    function onerror(message) {
        alert(message);
    }

    function createTempFile(callback) {

        var tmpFilename = new Date().toISOString() + ".epub";
        requestFileSystem(TEMPORARY, 4 * 1024 * 1024 * 1024, function(filesystem) {
            function create() {
                filesystem.root.getFile(tmpFilename, {
                    create : true
                }, function(zipFile) {
                    callback(zipFile);
                });
            }

            filesystem.root.getFile(tmpFilename, null, function(entry) {
                entry.remove(create, create);
            }, create);
        });
    }

    var epubZip = (function() {
        var obj = window;
         var zipFileEntry, zipWriter, writer, creationMethod = 'Blob', URL = obj.webkitURL || obj.mozURL || obj.URL;
 
         return {
             setCreationMethod : function(method) {
                 creationMethod = 'Blob';
             },
             addFiles : function addFiles(files, oninit, onadd, onprogress, onend) {
                 var addIndex = 0;
 
                 function nextFile() {
                     var file = files[addIndex];
                     onadd(file);
                     zipWriter.add(file.name, createReader(file), function() {
                         addIndex++;
                         if (addIndex < files.length)
                             nextFile();
                         else
                             onend();
                     }, onprogress);
                     function createReader(file){
                         return file.text ? new zip.TextReader(file.text) : new zip.Data64URIReader(file.blob);
                     }
                 }
 
                 function createZipWriter() {
                     zip.createWriter(writer, function(writer) {
                         zipWriter = writer;
                         oninit();
                         nextFile();
                     }, onerror);
                 }
 
                 if (zipWriter){
                     nextFile();
                 }else if (creationMethod == "Blob") {
                     writer = new zip.BlobWriter();
                     createZipWriter();
                 } else {
                     createTempFile(function(fileEntry) {
                         zipFileEntry = fileEntry;
                         writer = new zip.FileWriter(zipFileEntry);
                         createZipWriter();
                     });
                 }
             },
             getBlobURL : function(callback) {
                 zipWriter.close(function(blob) {
                     var blobURL = creationMethod == "Blob" ? URL.createObjectURL(blob) : zipFileEntry.toURL();
                     callback(blobURL);
                     zipWriter = null;
                 });
             },
             getBlob : function(callback) {
                 zipWriter.close(callback);
             }
         };
     })();


}



