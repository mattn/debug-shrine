const functions = require("firebase-functions")
const axios = require('axios')
var moment = require("moment")
const admin = require("firebase-admin")
const { getStorage } = require('firebase-admin/storage');
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore")
const { createCanvas, loadImage } = require("canvas")
const fs = require("fs");
const { ChartJSNodeCanvas } = require("chartjs-node-canvas")

const projectID = process.env.GCLOUD_PROJECT
const buggetName = `${projectID}.appspot.com`

if(process.env.FIREBASE_CONFIG){
  admin.initializeApp()
}else(
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: buggetName
  })
)
// admin.initializeApp()

const bucket = getStorage().bucket()
const db = getFirestore()

const client_id = functions.config().github.client_id
const client_secret = functions.config().github.client_secret

const fontStyle = {
  font: '60px "Noto Sans JP"',
  fontname: "Noto Sans JP",
  fontsize: "60",
  lineHight: 100,
  color: "#FFFFFF"
}
const target_points = [0,5,11,19,30,45,65,91,124,166,218,281,357,447,553,676,818,981,1167,1378,1616,1884,2184,2519,2892,3306,3764,4269,4825,5436,6106,6840,7643,8520,9477,10520,11656,12892,14236,15696,17281,19001,20867,22891,25086,27466,30046,32842,35872,39156]
const sanpai = {
  add_point: 20,
  next_time: 60 // * 60 * 24  // s
}

// Create and Deploy Your First Cloud Functions
// https://firebase.google.com/docs/functions/write-firebase-functions

function get_level(points) {
  level = 0
  for (let i=0; i < target_points.length; i++) {
    if (points <= target_points[i]) {
      level = i + 1
      break
    }
  }
  return level
}

function get_next_leve_exp(points) {
  let level = get_level(points)
  let return_data = {
    next_level: level + 1,
    next_exp: target_points[level]
  }
  return return_data
}


async function get_feed(user, per_page=100) {
  try {
    url = `https://api.github.com/users/${user}/events/public?per_page=${per_page}&client_id=${client_id}&client_secret=${client_secret}`
    const res = await axios.get(url);
    const items = res.data;
    return items
  } catch (error) {
    const {status,statusText} = error.response;
    functions.logger.error(`Error! HTTP Status: ${status} ${statusText}`, {structuredData: true})
  }
}

async function get_user(username) {
  try {
    url = `https://api.github.com/users/${username}`
    const res = await axios.get(url);
    const items = res.data;
    return items
  } catch (error) {
    const {status,statusText} = error.response;
    functions.logger.error(`Error! HTTP Status: ${status} ${statusText}`, {structuredData: true})
    return null
  }
}

function user_performance(items, username) {
  let user_data = {
    user: username,
    hp: 0,
    power: 0,
    defence: 0,
    dex: 0,
    agility: 0,
    intelligence: 0
  }

  
  previousItem = null
  continuous_count = 0
  let sorted_item = items.sort(function(a, b) {
    return (moment(a.created_at).unix() < moment(b.created_at).unix()) ? -1 : 1
  })
  for (const item of sorted_item) {
    if (previousItem) {
      previous_time = moment(previousItem.created_at)
      current_time = moment(item.created_at)
      diff = current_time.diff(previous_time)/1000
      if (30 < diff && diff <= 120) {
        user_data.agility += 6
      } else if (diff <= 180) {
        user_data.agility += 3
      } else if (diff <= 300) {
        user_data.agility += 2
      } else if (diff <= 1200) {
        user_data.agility += 1
      }
      if (diff <= 7200) {
        continuous_count++
      } else {
        user_data.hp += continuous_count * 2
        continuous_count = 0
      }
    }
    switch (item.type) {
      case "ForkEvent":
        user_data.power += 1
        break
      case "PushEvent":
        user_data.power += 2
        break
      case "CreateEvent":
      case "DeleteEvent":
        user_data.power += 1
        break
      case "PullRequestEvent":
        user_data.power += 3
        break
      case "IssuesEvent":
        switch (item.payload) {
          case "opened":
            user_data.intelligence += 3
            break
          case "closed":
            user_data.defence += 5
            break
        }
        break
      case "IssueCommentEvent":
        user_data.intelligence += 2
        break
      case "PullRequestReviewEvent":
        user_data.defence += 3
        break
      case "PullRequestReviewCommentEvent":
        user_data.defence += 3
        break
      case "GollumEvent":
        user_data.defence += 3
        break
      case "ReleaseEvent":
        user_data.defence += 10
        break
    }
    previousItem = item
  }
  if (continuous_count > 0) {
    user_data.hp += continuous_count * 2
  }

  return user_data
}

function user_formated_performance(user_data, append_data={}) {
  let return_Data = {
    user: user_data.user,
    points: user_data.hp + user_data.power + user_data.intelligence + user_data.defence + user_data.agility,
    hp: user_data.hp,
    power: user_data.power,
    intelligence: user_data.intelligence,
    defence: user_data.defence,
    agility: user_data.agility,
    total: user_data.hp + user_data.power + user_data.intelligence + user_data.defence + user_data.agility,
    level: 0,
    exp: 0,
    next_exp: 0,
    chart: {
      hp: 0,
      power: 0,
      intelligence: 0,
      defence: 0,
      agility: 0
    }
  }
  // 経験値を反映
  if(append_data.exp) {
    return_Data.exp += append_data.exp
  }

  return_Data.chart.hp = return_Data.hp
  return_Data.chart.power = return_Data.power,
  return_Data.chart.intelligence = return_Data.intelligence
  return_Data.chart.defence = return_Data.defence
  return_Data.chart.agility = return_Data.agility

  return_Data.level = get_level(return_Data.points)
  return_Data.next_exp = get_next_leve_exp(return_Data.points).next_exp
  return return_Data
}

exports.status = functions.https.onRequest(async (request, response) => {
  response.set("Access-Control-Allow-Origin", "*")
  functions.logger.info("status", {structuredData: true})
  functions.logger.info(request.query.user, {structuredData: true})

  const github_data = await get_user(request.query.user)
  if(github_data == null) {
    // missing user
    response.status(404).json({
      status: "faild",
      message: "user not found."
    })
    return
  }

  const github_id = github_data.id
  let appendData = {}

  const userRef = db.collection("users").doc(`${github_id}`)
  const userDoc = await userRef.get()
  if(userDoc.exists) {
    // ユーザーは登録さている
    functions.logger.info("user registerd")
    const userData = userDoc.data()
    functions.logger.info(`data: ${userData.exp}`)
    if(userData.exp) {
      appendData.exp = userData.exp
    }
  }else {
    // 登録されていない
    functions.logger.info("user not registerd")
    response.status(404).json({
      staus: "faild",
      message: "user not registerd."
    })
    return
  }

  const items = await get_feed(request.query.user)
  let user_data = user_performance(items, request.query.user)
  let return_Data = user_formated_performance(user_data, appendData)

  response.json(return_Data)
})

exports.userOGP = functions.https.onRequest(async (request, response) => {
  response.set('Access-Control-Allow-Headers', '*')
  response.set("Access-Control-Allow-Origin", "*")
  response.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST')

  functions.logger.info(request.query)
  if(!request.query.user){
    // 404で返す
    response.status(404).send("user not found.")
    return
  }

  const username = request.query.user
  const filepath = `ogps/${encodeURIComponent(username)}.png`

  fileExists = await isStrageExists(filepath)
  functions.logger.info(`file ${filepath}: ${fileExists}`)

  let url
  if(fileExists){
    // 既存
    url = getOgpUrl(username)
  }else{
    // 作成
    url = await createOgp(username, request, response)
  }

  if(process.env.FUNCTIONS_EMULATOR) {
    // エミュレーター上は検証がめんどいからリダイレクトしない
    // できればその場で画像出てくれたら良いのになぁ...
    response.send(url)
  }else {
    if(url) {
      response.redirect(url)
    }
  }
})

// strageに指定ファイル名のものが存在するか
async function isStrageExists(filepath) {
  data = await bucket.file(filepath).exists()
  return data[0]
}

function getOgpUrl(username) {
  // ファイルチェックしてURL返したい
  url = `https://firebasestorage.googleapis.com/v0/b/${buggetName}/o/ogps%2F${encodeURIComponent(username)}.png?alt=media`
  if(process.env.FUNCTIONS_EMULATOR){
    url = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/download/storage/v1/b/${buggetName}/o/ogps%2F${encodeURIComponent(username)}.png?alt=media`
  }

  return url
}

async function createOgp(username, request, response) {
  const basePath = "base.png"
  const localBasePath = "/tmp/base.png"
  const targetPath = `ogps/${encodeURIComponent(username)}.png`
  const localTargetPath = "/tmp/target.png"

  baseexists = await isStrageExists(basePath)

  functions.logger.info(`${basePath} is ${baseexists}`)
  if(!baseexists){
    functions.logger.warn(`missing base.png!: ${baseexists}`)
    response.status(500).send("server missing.")
    return
  }
  await bucket.file(basePath).download({
    destination: localBasePath,
    validation: !process.env.FUNCTIONS_EMULATOR // エミュレーター時必要
  })

  // init image
  const baseImage = await loadImage(localBasePath)
  const canvas  = createCanvas(baseImage.width, baseImage.height)
  const ctx = canvas.getContext("2d")
  ctx.drawImage(baseImage, 0, 0, baseImage.width, baseImage.height)

  const userData = await get_user(username)
  if(userData == null) {
    response.status(404).send("user not found.")
    return
  }
  const imageURL = userData.avatar_url
  const userDisplayName = userData.name ? userData.name : userData.login
  const userFeedRawData = await get_feed(username)
  let appendData = {}
  const userRef = db.collection("users").doc(`${userData.id}`)
  const userDoc = await userRef.get()
  if(userDoc.exists) {
    functions.logger.info("user registerd")
    const userData = userDoc.data()
    functions.logger.info(`data: ${userData.exp}`)
    if(userData.exp) {
      appendData.exp = userData.exp
    }
  }

  const userFeedData = user_formated_performance(user_performance(userFeedRawData, username), appendData)

  // generate
  ctx.font = fontStyle.font
  ctx.fillStyle = fontStyle.color
  ctx.textBaseline = "top"

  // 名前
  const userPos = {
    x: 700,
    y: 310,
    max: 1280
  }
  ctx.fillText(userDisplayName, userPos.x, userPos.y, (userPos.max-userPos.x))

  // アイコン
  const userIcon = await loadImage(imageURL)
  functions.logger.info(`icon w: ${userIcon.width}, h:${userIcon.height}`)
  const iconPos = {
    x: 680,
    y: 431,
    range: 893-784,
    iconSize: 215 // アイコンの大きさ
  }
  const userIconCanvas = createCanvas(userIcon.width, userIcon.height)
  const userCtx = userIconCanvas.getContext("2d")
  // 切り取られてないアイコンがあるので切り取り
  userCtx.beginPath()
  wi = userIcon.width/2
  yi = userIcon.height/2
  ri = userIcon.width/2*0.9
  rr = Math.PI*360/180
  userCtx.arc(wi, yi, ri, 0, rr, false)
  userCtx.clip()
  userCtx.drawImage(userIcon, 0, 0, userIcon.width, userIcon.height)

  ctx.drawImage(userIconCanvas, iconPos.x, iconPos.y, iconPos.iconSize, iconPos.iconSize)
  
  // レベル
  const userDataStr = [
    "れべる：" + userFeedData.level,
    "ポイント：" + userFeedData.points,
    "せんとうりょく：" + userFeedData.total
  ]

  for (let idx=0; idx < userDataStr.length; idx++) {
    ctx.fillText(
      userDataStr[idx],
      680,
      740 + fontStyle.lineHight * idx
    )
  }
  // チャート
  const chartPost = {
    x: 1325,
    y: 300
  }
  const chartWidht = 550
  const chartHight = 550
  const chartbackColor = "rgba(255,255,255,0)"//"rgba(0,0,0,0)"
  const userChatData = [
    userFeedData.hp,
    userFeedData.power,
    userFeedData.intelligence,
    userFeedData.defence,
    userFeedData.agility,
  ]
  const chartLabels = [
    "たいりょく", // hp
    "ちから", // power
    "かしこさ", // intelligence
    "しゅびりょく", // defence
    "すばやさ", // agility
  ]

  const chartGrafLineColor = "rgb(242,242,242)" // グラフの線,文字
  const chartconfig = {
    type: "radar",
    data: {
      labels: chartLabels,
      datasets: [
        {
          // データ
          data: userChatData,
          fill: true,
          backgroundColor: "rgba(0, 168, 228,0.6)",
          borderColor: "rgb(0, 117, 159)",
          borderWidth: 2
        }
      ]
    },
    options: {
      plugins: {
        title: {
          // タイトル
          display: false
        },
        legend: {
          // 凡例
          display: false,
          fontSize: 30
        },
      },

      scale: {
        ticks: {
          // 線の間隔
          stepSize: 10,
        }
      },
      elements: {
        point: {
          radius: 0 // 点は非表示
        }
      },
      scales: {
        r: {
          min: 0,
          grid: {
            // メモリ
            display: true,
            color: chartGrafLineColor,
            lineWidth: 3,  // (データ幅)線の幅
          },
          angleLines: {
            // 伸びてる方のめもり
            color: chartGrafLineColor,
            lineWidth: 3
          },
          pointLabels: {
            // れべるとか
            color: chartGrafLineColor,
            font: {
              size: 25
            }
          },
          ticks: {
            // メモリの数字
            display: false,
          }
        }
      }
    }
  }

  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: chartWidht, 
    height: chartHight,
    chartCallback: (ChartJS) => {
      // ChartJS.defaults.global.font.size = "rgb(255,255,255)"
    }
  })
  const chart = await chartJSNodeCanvas.renderToBuffer(chartconfig, "image/png")
  const chartfile = "/tmp/chart.png"
  fs.writeFileSync(chartfile, chart)
  const chartimage = await loadImage(chartfile)
  // ctx.drawImage(chartimage, 0, 0, chartimage.width, chartimage.height)
  ctx.drawImage(chartimage, chartPost.x,chartPost.y, chartimage.width, chartimage.height)

  // // upload
  const buf = canvas.toBuffer()
  fs.writeFileSync(localTargetPath, buf)

  await bucket.upload(localTargetPath, {
    destination: targetPath
  })

  fs.unlinkSync(localBasePath)
  fs.unlinkSync(localTargetPath)

  return getOgpUrl(username)
}

exports.register = functions.https.onRequest(async (requeset, response)=>{
  response.set('Access-Control-Allow-Headers', '*')
  response.set("Access-Control-Allow-Origin", "*")
  response.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST')
  if(requeset.method != "POST"){
    response.json({
      status: "missing request"
    })
    return
  }

  // firestore に投げられたデータを保存
  // {
  //   github_id, display_name, screen_name, image_path 
  // }
  // firestoreに書き込み
  // key: github_id
  if(
    !requeset.body.github_id ||
    !requeset.body.display_name ||
    !requeset.body.screen_name ||
    !requeset.body.image_path
    ){
      // functions.logger.info(requeset.body)
      response.json({
        status: "faild parameter"
      })
    return
  }

  const userRef = db.collection("users").doc(`${requeset.body.github_id}`)
  
  userRef.set({
    github_id: requeset.body.github_id,
    display_name: requeset.body.display_name,
    screen_name: requeset.body.screen_name,
    image_path: requeset.body.image_path
  })

  response.json({
    status: "success"
  })
})

exports.sanpai = functions.https.onRequest(async(request, response) => {
  response.set('Access-Control-Allow-Headers', '*')
  response.set("Access-Control-Allow-Origin", "*")
  response.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS, POST')
  if(request.method != "POST") {
    functions.logger.info("faild conection")
    response.json({
      status: "faild"
    })
    return
  }

  if(!request.body.github_id) {
    response.json({
      status: "faild parameter"
    })
    return
  }
  const github_id = request.body.github_id
  const userRef = db.collection("users").doc(`${github_id}`)
  
  functions.logger.info("load")
  try {

    functions.logger.info("get 1")
    const userDoc = await userRef.get()
    functions.logger.info("get 2" )

    if(!userDoc.exists) {
      // 登録されてない
      response.json({
        "status": "faild",
        "message": "not registered"
      })
      return
    }
    functions.logger.info("registerd")
    let userStatusFeed = null
    let userStatusData = null
    let userAppendData = {}

    const userData = userDoc.data()
    functions.logger.info(userData)
    if(userData.exp) {
      userAppendData.exp = userData.exp
    }
    userStatusFeed = await get_feed(userData.screen_name)
    userStatusData = user_formated_performance(user_performance(userStatusFeed, userData.screen_name), userAppendData)
    const last_sanpai = userData.last_sanpai

    if(last_sanpai) {
      //参拝してる
      
      functions.logger.info(last_sanpai)
      functions.logger.info(last_sanpai.seconds)
      // 前回の時間指定時間足して、期限がすぎる時間 今の時間
      if(last_sanpai.seconds + sanpai.next_time > Timestamp.now().seconds) {
        // 参拝可能時間を過ぎてない
        // functions.logger.info("expire")
        response.json({
          status: "expire",
          add_exp: 0,
          level: userStatusData.level,
          exp: userStatusData.points,
          next_exp: get_next_leve_exp(userStatusData.points).next_exp
        })
        return
      }
    }
    // 更新
    await userRef.update({
      last_sanpai: FieldValue.serverTimestamp(),
      exp: FieldValue.increment(sanpai.add_point)
    })
    const sanpai_logsRef = userRef.collection("sanpai_logs")
    const sanpaiRes = await sanpai_logsRef.add({
      add_point: sanpai.add_point,
      timestamp: FieldValue.serverTimestamp()
    })

    const dbBatch = db.batch()
    const github_acitivityRef = userRef.collection("github_activities")
    // アクティビティ更新
    const feed_items = userStatusFeed//2021-12-28T06:26:21Z
    date = last_sanpai ? last_sanpai.seconds: moment("2008-04-01T00:00:00Z").unix() // github
    let splited_items = feed_items.filter(item => (moment(item.created_at).unix()) > date)
    functions.logger.info(splited_items.length)
    for(i=0;i<splited_items.length;i++) {
      let item = {
        id: splited_items[i].id,
        type: splited_items[i].type,
        created_at: splited_items[i].created_at,
        raw: JSON.stringify(splited_items[i])
      }
      let ref = github_acitivityRef.doc(item.id)
      dbBatch.set(ref, item)
    }
    await dbBatch.commit()

    // 最新状態を取得
    if(userData.exp) {
      userAppendData.exp = userData.exp + sanpai.add_point
    }else {
      userAppendData.exp = sanpai.add_point
    }
    userStatusData = user_formated_performance(user_performance(userStatusFeed, userData.screen_name), userAppendData)
    response.json({
      status: "success",
      add_exp: sanpai.add_point,
      level: userStatusData.level,
      exp: userStatusData.points,
      next_exp: get_next_leve_exp(userStatusData.points).next_exp
    })
  }catch(e) {
    functions.logger.error("transaction failure", e)
    response.json({
      status: "missing server error."
    })
    return
  }
})