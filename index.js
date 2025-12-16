require('dotenv').config()
const express = require('express')
const { ObjectId } = require('mongodb');
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const admin = require('firebase-admin')
const app = express()

// middleware
app.use(
  cors({
    origin: [process.env.DOMAIN_URL],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  // console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    // console.log(decoded)
    next()
  } catch (err) {
    // console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

// Firebase initialization
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

// MongoDB client
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})

async function run() {
  try {
    const db = client.db('plantsDB')
    const plantsCollection = db.collection('plants')
    const ordersCollection = db.collection('orders')
    const usersCollection = db.collection('users')

    // save a plant data in db
    app.post('/plants', async (req, res) => {
      const plantData = req.body;
      // console.log(plantData);
      const result = await plantsCollection.insertOne(plantData)
      res.send(result);
    })

    // get all orders for a customer email
    app.get('/my-orders/:email', async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection.find({ customer: email }).toArray();
      res.send(result);
    });

    // get all orders for a seller email
    app.get('/manage-order/:email', async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection.find({ 'seller.email': email }).toArray();
      res.send(result);
    });

    // get all orders for admin
    app.get('/admin-orders', async (req, res) => {
      const result = await ordersCollection.find().toArray();
      res.send(result);
    });

    // get all plant for a seller by email
    app.get('/my-inventory/:email', async (req, res) => {
      const email = req.params.email;
      const result = await plantsCollection.find({ 'seller.email': email }).toArray();
      res.send(result);
    });

    // get all plants from db
    app.get('/plants', async (req, res) => {
      const cursor = plantsCollection.find()
      const result = await cursor.toArray();
      res.send(result)
    })

    // get plant by id
    app.get('/plants/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await plantsCollection.findOne(query)
      res.send(result)
    })


    // Payment endpoints
    app.post('/create-checkout-session', async (req, res) => {
      const paymentInfo = req.body;
      // console.log(paymentInfo);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: paymentInfo?.name,
                description: paymentInfo?.description,
                images: [paymentInfo?.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.customer?.email,
        mode: 'payment',
        metadata: {
          plantId: paymentInfo?.plantId,
          customer: paymentInfo?.customer.email,

        },
        success_url: `${process.env.DOMAIN_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.DOMAIN_URL}/plant/${paymentInfo?.plantId}`,
      })
      res.send({ url: session.url })
    })

    app.post('/payment-success', async (req, res) => {
      const { sessionId } = req.body
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const plant = await plantsCollection.findOne({ _id: new ObjectId(session.metadata.plantId) })


      const order = await ordersCollection.findOne({ transactionId: session.payment_intent })

      if (session.status = 'complete' && plant && !order) {
        // Fetch user to get address
        const user = await usersCollection.findOne({ email: session.metadata.customer })

        // save order data in db
        const orderInfo = {
          plantId: session.metadata.plantId,
          transactionId: session.payment_intent,
          customer: session.metadata.customer,
          status: 'Pending',
          seller: plant.seller,
          name: plant.name,
          category: plant.category,
          quantity: 1,
          price: session.amount_total / 100,
          image: plant?.image,
          address: user?.address || 'Dhaka' // Fallback to 'Dhaka' if not set
        }
        const result = await ordersCollection.insertOne(orderInfo)
        // update plant quantity
        await plantsCollection.updateOne(
          { _id: new ObjectId(session.metadata.plantId) },
          { $inc: { quantity: -1 } }
        )
        return res.send({ transactionId: session.payment_intent, orderId: result.insertedId })
      }
      res.send(res.send({ transactionId: session.payment_intent, orderId: order._id }))
    })

    // update a plant
    app.patch('/plants/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const item = req.body;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true }
      const updateDoc = {
        $set: {
          name: item.name,
          category: item.category,
          price: parseFloat(item.price),
          quantity: parseInt(item.quantity),
          description: item.description,
          image: item.image,
        }
      }
      const result = await plantsCollection.updateOne(filter, updateDoc, options);
      res.send(result);
    });

    // delete a plant
    app.delete('/plants/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.deleteOne(query);
      res.send(result);
    });

    // delete a order
    app.delete('/orders/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const order = await ordersCollection.findOne(query)
      if (order.status === 'Delivered')
        return res
          .status(409)
          .send({ message: 'Cannot cancel once the product is delivered!' })
      const result = await ordersCollection.deleteOne(query)
      const updateDoc = {
        $inc: { quantity: 1 },
      }
      const filter = { _id: new ObjectId(order.plantId) }
      const updatedResult = await plantsCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    // save or update a user in db
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email
      const query = { email }
      const user = req.body
      // check if user exists in db
      const isExist = await usersCollection.findOne(query)
      if (isExist) {
        const result = await usersCollection.updateOne(query, {
          $set: { ...user, timestamp: Date.now() },
        })
        return res.send(result)
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: 'customer',
        timestamp: Date.now(),
      })
      res.send(result)
    })

    // update order status
    app.patch('/orders/status/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const status = req.body.status
      const query = { _id: new ObjectId(id) }
      const updateDoc = {
        $set: { status: status },
      }
      const result = await ordersCollection.updateOne(query, updateDoc)
      res.send(result)
    })

    // get all users
    // verifyAdmin
    app.get('/users', verifyJWT, async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    // Get Admin Statistics
    app.get('/admin-stat', verifyJWT, async (req, res) => {
      // Get total users, plants
      const totalUsers = await usersCollection.estimatedDocumentCount()
      const totalPlants = await plantsCollection.estimatedDocumentCount()

      // Get total orders
      // const totalOrders = await ordersCollection.estimatedDocumentCount() 
      // The user might want total orders count to be just the length of all orders. 
      // But typically "Total Orders" means all orders placed.

      const orderDetails = await ordersCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: {
              $sum: {
                $cond: [{ $eq: ["$status", "Delivered"] }, "$price", 0]
              }
            },
            totalOrders: { $sum: 1 }
          }
        }
      ]).toArray();

      const revenue = orderDetails.length > 0 ? orderDetails[0].totalRevenue : 0;
      const totalOrders = orderDetails.length > 0 ? orderDetails[0].totalOrders : 0;

      res.send({
        totalUsers,
        totalPlants,
        totalOrders,
        revenue
      })
    })

    // update user role
    app.patch('/users/update/:email', verifyJWT, async (req, res) => {
      const email = req.params.email
      const user = req.body
      const query = { email }
      const updateDoc = {
        $set: { ...user, status: null, timestamp: Date.now() },
      }
      const result = await usersCollection.updateOne(query, updateDoc)
      res.send(result)
    })

    // get user role
    app.get('/users/:email', async (req, res) => {
      const email = req.params.email
      const result = await usersCollection.findOne({ email })
      res.send(result)
    })








    // ping MongoDB
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // client closing optional
  }
}
run().catch(console.dir)

// root route
app.get('/', (req, res) => {
  res.send('PlantNet Server Running..')
})



// start server
const port = process.env.PORT || 3000
app.listen(port, () => {
  // console.log(`Server is running on port ${port}`)
})
