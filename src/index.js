import axios from 'axios';
import geoTz from 'geo-tz';
import moment from 'moment-timezone';

const getRequest = async (url, queryParameters) => {
  return await axios({
  method: 'GET',
  url,
  params: queryParameters
});
}

export async function handler(event, context){

  console.log(JSON.stringify(event));


  const {lat, lon, radius, timeFrame, numberHotspots} = event.queryStringParameters;
  const timezone = geoTz(lat, lon);

  console.log(JSON.stringify(timezone));

  let time = moment().tz(timezone[0]);
  let startTime = time.format('H:mm');
  console.log(startTime);

  let endTime = time.add(timeFrame, 'minutes').format('H:mm');
  console.log(endTime);

  //startTime = '9:00';
  //endTime = '12:00';


  const {CRM_URL, WEATHER_URL, HOTSPOT_URL, USER_PROFILE_URL, NEARBY_SPONSORS_URL, ROUTE_OPTIMIZATION_URL} = process.env;
  console.log({
    lat,
    lon,
    radius,
    timeFrame,
    numberHotspots,
    url: `${USER_PROFILE_URL}8cb4a87dc7923d75d6406c0c3fc28533`
  });

  const weatherParameters = {
    lat,
    lon
  };

  const hotspotParameters = {
    lat,
    lon,
    radius
  };

  const crmRequest = getRequest(CRM_URL);
  const weatherRequest = getRequest(WEATHER_URL, weatherParameters);
  const hotspotRequest = getRequest(HOTSPOT_URL, hotspotParameters);
  const userProfileRequest = getRequest(`${USER_PROFILE_URL}8cb4a87dc7923d75d6406c0c3fc28533`);

  const [crmResponse, weatherResponse, hotspotResponse, userProfileResponse] = await Promise.all([crmRequest, weatherRequest, hotspotRequest, userProfileRequest]);
  console.log(JSON.stringify({user: userProfileResponse.data}));

  console.log(JSON.stringify({crm: crmResponse.data, weather: weatherResponse.data, hotspots: hotspotResponse.data}));

  // Step 1: filter based on weather
  const {goodWeather, day} = weatherResponse.data.msg;
  const weatherFilter = 'museum';
  console.log(weatherFilter);
  console.log(JSON.stringify(hotspotResponse.data.msg));
  const weatherHotspots = goodWeather ? hotspotResponse.data.msg.filter(e => (e.types && !e.types.includes(weatherFilter))) : hotspotResponse.data.msg.filter(e => (e.types && e.types.includes(weatherFilter)));

  console.log(JSON.stringify(weatherHotspots));

  // Step 2: Filter according user userProfile
  const keyWords = Object.keys(userProfileResponse.data.keywords);
  //keyWords.push('Deutsches');
  const userProfileHotspots = weatherHotspots.filter(e => keyWords.reduce((acc = true, curr) => (!(e.name.toLowerCase().includes(curr.toLowerCase())) && acc)));

  console.log(JSON.stringify(userProfileHotspots));

  // Step 3: Consider only first numberHotspots

  const slicedHotspots = userProfileHotspots.slice(0, numberHotspots);

  console.log(JSON.stringify(slicedHotspots));

  // Step 4: add Sponsors

  const nearbySponsorsRequests = [];

  const keyword = keyWords.reduce((acc, curr) => userProfileResponse.data.keywords[curr] > userProfileResponse.data.keywords[acc] ? curr : acc) || 'Starbucks';

  console.log(keyword);

  slicedHotspots.map(e => nearbySponsorsRequests.push(getRequest(NEARBY_SPONSORS_URL,
    {
      lat: e.geometry.location.lat,
      lon: e.geometry.location.lng,
      keyword
  })));

  const nearbySponsorsResponse = await Promise.all(nearbySponsorsRequests);

  const sponsorToAdd = nearbySponsorsResponse.reduce((acc = {}, curr) => ((acc.data.msg.wayTo.distance.value > curr.data.msg.wayTo.distance.value) ? curr : acc));

  console.log(JSON.stringify(sponsorToAdd.data));

  slicedHotspots.push(sponsorToAdd.data.msg.result);

  // Step 5: Vehicle Routing Problem - find optimized routing

  const fleet = {
    "you": {
      "start_location": {
        id: "curr_location",
        "name": "curr_location",
        "lat": lat,
        "lng": lon
      },
      "shift_start": startTime,
      "shift_end": endTime,
      "speed": 0.1

    }
  };

  const visits = {};
  slicedHotspots.map((e, index) => visits[index] = {
    location: {
      name: e.name,
      lat: e.geometry.location.lat,
      lng: e.geometry.location.lng
    }
  });

  console.log(JSON.stringify(fleet));
  console.log(JSON.stringify(visits));

  const optimizedRoutingRaw = await axios({
  method: 'POST',
  url: ROUTE_OPTIMIZATION_URL,
  data: {
    visits,
    fleet
  }
  });

  const optimizedRouting = optimizedRoutingRaw.data.msg.solution.you;

  console.log(JSON.stringify(optimizedRouting));

  const resultArray = [];

  optimizedRouting.filter(e => e.location_id !== "curr_location").map(e => resultArray.push(slicedHotspots[parseInt(e.location_id)]));

  console.log(JSON.stringify(resultArray));


  return Promise.resolve({
    statusCode: 200,
    headers: {
     'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': true,
     },
    body: JSON.stringify({
    msg: resultArray}),
  });
}
