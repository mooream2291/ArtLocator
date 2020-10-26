'use strict';

//dependencies
const express = require('express');
const app = express();
const superagent = require('superagent');
const env = require('dotenv');
const pg = require('pg');
const cors = require('cors');
const methodOverride = require('method-override');

//client side configs
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('./public'));
app.use(methodOverride('_method'));
app.set('view engine', 'ejs');


//server side configs
env.config();
const PORT = process.env.PORT || 3300;
const client = new pg.Client(process.env.DATABASE_URL);

//global variables

//connect to db
client.connect();
client.on('error', error => handleErrors(error));

//handle application routes
app.get('/', showHomepage);
app.post('/searches', getArtworkResults);

//object constructors

function ArtWork(museum, artistName, artworkTitle, artworkImage, artworkDescription) {
  this.museum = museum;
  this.artistName = artistName;
  this.artworkImage = artworkImage;
  this.artworkDescription = artworkDescription;
  this.artworkTitle = artworkTitle;
}

//functions
function showHomepage(req, res) {
  //retrieve favorites here

  //then render the page
  res.render('pages/index');
}

function getArtworkResults(req, res) {
  //get the term the user searched for
  let artist = req.body.search;

  //------------------------------------------------------------------------------
  // Get the results for the search query from the smithsonian's api
  //------------------------------------------------------------------------------

  //set the url for smithsonian API
  let url = `https://api.si.edu/openaccess/api/v1.0/category/art_design/search?q=${artist}&api_key=${process.env.SMITHSONIAN_APIKEY}`;

  //call the smithsonian's API
  superagent.get(url)
    .then(smithsonianData => {
      //create an array of artworks that we will add all the smithsonian results to
      var allArtworks = [];
      //narrow down the results to those where the artist name matches the search query by using .filter on the returned array.
      //this API doesn't let you narrow the search to be by artist name only, so we have to do it manually here.
      var rows = smithsonianData.body.response.rows.length > 0 ? smithsonianData.body.response.rows.filter(item => item.content.freetext.name[0].content.toLowerCase().indexOf(artist.toLowerCase()) > -1) : [];

      //now iterate on the remaining rows and add the artworks to the array we created
      rows.forEach(item => {
        //check if the item's artist name matches the search query, because these APIs don't let you limit to artist name search only.
        allArtworks.push(new ArtWork(
          item.content.descriptiveNonRepeating.data_source,
          item.content.freetext.name[0].content,
          item.title,
          //if there is online_media, then check how many items are in it. If more than 0, then set the image URL to the thumbnail of the first image. Otherwise, set this field to null so we don't render an image on the page.
          item.content.descriptiveNonRepeating.online_media ? (item.content.descriptiveNonRepeating.online_media.mediaCount > 0 ? item.content.descriptiveNonRepeating.online_media.media[0].thumbnail : null) : null,
          //if there are notes describing the artwork, save the first note's content.  Otherwise, set this field to null so we don't display it on the page
          item.content.freetext.notes ? (item.content.freetext.notes[0].content ? item.content.freetext.notes[0].content : null) : null
        ));
      });
      console.log(allArtworks);
      return allArtworks;
    })
    //then, take the array of Artwork objects we created from the Smithsonian superagent call, and send it to get MET results
    .then(data => {
      var allArtworks = data;
      //get the results for the search query from the MET
      let url = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${artist}&artistOrCulture`;
      //call the MET's API which will return a list of object IDs that match the search query.
      //create a promises array to place all the gets we want based on the returned object IDs, then execute them all at once.
      var promises = [];
      superagent.get(url)
        .then(metData => {
          var rows = metData.body.objectIDs;
          //for each object ID we get back from the MET query, we now need to create another superagent call to get the details of that object
          rows.forEach(item => {
            //set the url for each item and push the superagent.get call into the promises array
            let eachObjectURL = `https://collectionapi.metmuseum.org/public/collection/v1/objects/${item}`;
            promises.push(superagent.get(eachObjectURL));
          });
          //run the promises array so that we go ahead and call each of the saved superagent.get calls sequentially
          Promise.all(promises)
            .then(data => {
              //now we have "data" which is an aggregate of all the results from the superagent.get calls of each artwork

              //for each object in data, check whether its artist field matches the search query,
              //if it does, then create an object for it and add it to the artworks array.
              //if it doesn't, then just ignore that result.
              data.forEach(objectData => {
                if (objectData.body.artistDisplayName.toLowerCase().indexOf(artist.toLowerCase()) > -1) {
                  console.log(objectData.body.artistDisplayName);
                  //the user's search query matches the artist's name, so create the object and push it into the allArtworks array.
                  allArtworks.push(new ArtWork(
                    objectData.body.repository,
                    objectData.body.artistDisplayName,
                    objectData.body.title,
                    objectData.body.primaryImage,
                    null
                  ));
                }
              })
              //we are done adding the MET results to the artworks array. Return it so that the next .then block can use it.
              return allArtworks;
            })
            //now that we have the allArtworks array returned from the previous .then, render that array to the artworks page.
            .then(data => {
              //console.log(data);
              res.render('pages/artworks', { artworks: data, query: artist });
            })
            .catch(error => handleErrors(error, res));
        })
    });
}

function handleErrors(error, res) {
  //render the error page with the provided error message.
  console.error(error.message);
  if (res) {
    res.render('pages/error', { error: error });
  }
}

//catch all for unknown routes
app.get('*', handleErrors);

//start up the server
app.listen(PORT, () => {
  console.log(`Server is up on port `, PORT);
});
