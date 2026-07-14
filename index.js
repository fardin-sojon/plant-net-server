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
    origin: [
      'http://localhost:5173',
      'https://fardins.shop',
      'https://plant-net-11.web.app',
      'https://plant-net-11.firebaseapp.com'
    ],
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
    let email = decoded.email
    if (!email && decoded.uid) {
      try {
        const userRecord = await admin.auth().getUser(decoded.uid)
        email = userRecord.email || userRecord.providerData?.[0]?.email
      } catch (userErr) {
        console.error('Error fetching user by uid:', userErr)
      }
    }
    req.tokenEmail = email
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

    app.use(async (req, res, next) => {
      try {
        await client.connect()
        next()
      } catch (err) {
        next(err)
      }
    })

    const db = client.db('plantsDB')
    const plantsCollection = db.collection('plants')
    const ordersCollection = db.collection('orders')
    const usersCollection = db.collection('users')
    const paymentsCollection = db.collection('payments')
    const contactCollection = db.collection('messages')
    const wishlistCollection = db.collection('wishlist')
    const reviewsCollection = db.collection('reviews')
    const couponsCollection = db.collection('coupons')

    // save a plant data in db
    app.post('/plants', async (req, res) => {
      const plantData = req.body;
      // console.log(plantData);
      const result = await plantsCollection.insertOne(plantData)
      res.send(result);
    })



    // get all plant for a seller by email
    app.get('/my-inventory/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });
      let query = { 'seller.email': email };
      if (user && user.role === 'admin') {
        query = {}; // Admin can see all plants
      }
      const result = await plantsCollection.find(query).sort({ _id: -1 }).toArray();
      res.send(result);
    });

    // get all plants from db
    app.get('/plants', async (req, res) => {
      const cursor = plantsCollection.find().sort({ _id: -1 })
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
      try {
        const { items, customer, couponCode } = req.body;
        const price = items.reduce((total, item) => total + item.price * item.quantity, 0);

        let discount = 0;
        let discountRatio = 1;

        if (couponCode) {
          const coupon = await couponsCollection.findOne({ code: couponCode.toUpperCase() });
          if (coupon) {
            if (coupon.discountType === 'percent') {
              discount = (parseFloat(coupon.discountAmount) / 100) * price;
            } else {
              discount = parseFloat(coupon.discountAmount);
            }
            discount = Math.min(discount, price);
            discountRatio = (price - discount) / price;
          }
        }

        const lineItems = items.map(item => ({
          price_data: {
            currency: 'usd',
            product_data: {
              name: item.name,
              images: [item.image],
            },
            unit_amount: Math.round(item.price * discountRatio * 100),
          },
          quantity: item.quantity,
        }));

        const session = await stripe.checkout.sessions.create({
          line_items: lineItems,
          customer_email: customer.email,
          mode: 'payment',
          success_url: `${process.env.DOMAIN_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.DOMAIN_URL}/cart`,
        });

        // Create Pending Orders
        const orders = items.map(item => ({
          plantId: item._id,
          transactionId: session.id, // Use session ID as temporary transaction ID
          customer: customer.email,
          customerName: customer.recipientName || customer.name || '',
          status: 'Pending',
          seller: item.seller, // Ensure this exists in plant object
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          price: Math.round(item.price * discountRatio * 100) / 100, // Apply discount proportionally
          image: item.image,
          address: customer.address || 'Dhaka',
          phone: customer.phone || '',
          createdAt: new Date(),
          timestamp: Date.now()
        }));

        await ordersCollection.insertMany(orders);

        res.send({ url: session.url });
      } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(400).send({ message: error.message });
      }
    })

    app.post('/payment-success', async (req, res) => {
      try {
        const { sessionId } = req.body;
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === 'paid') {
          const transactionId = session.id;
          const paymentIntentId = session.payment_intent;

          // 1. Find orders BEFORE updating (using original session.id)
          let orders = await ordersCollection.find({ transactionId: transactionId }).toArray();

          // If no orders found with session.id, check if already processed
          if (orders.length === 0) {
            orders = await ordersCollection.find({ transactionId: paymentIntentId }).toArray();

            // If found with paymentIntentId, already processed - return success
            if (orders.length > 0) {
              return res.send({ transactionId: paymentIntentId, success: true });
            }

            // Otherwise return error
            return res.status(400).send({ message: 'No orders found for this session', success: false });
          }

          // 2. Update Order Status
          const updateResult = await ordersCollection.updateMany(
            { transactionId: transactionId },
            {
              $set: {
                status: 'Pending',
                transactionId: paymentIntentId // Update to actual payment intent
              }
            }
          );

          // 3. Decrement Quantity for each plant
          for (const order of orders) {
            await plantsCollection.updateOne(
              { _id: new ObjectId(order.plantId) },
              { $inc: { quantity: -order.quantity } }
            );
          }

          // 4. Save payment data to payments collection
          const paymentData = {
            sessionId: session.id,
            paymentIntentId: paymentIntentId,
            customer: session.customer_email,
            customerName: orders[0]?.customerName || '',
            amount: session.amount_total / 100, // Convert from cents to dollars
            currency: session.currency,
            paymentStatus: session.payment_status,
            address: orders[0]?.address || '',
            phone: orders[0]?.phone || '',
            items: orders.map(order => ({
              plantId: order.plantId,
              name: order.name,
              quantity: order.quantity,
              price: order.price
            })),
            createdAt: new Date(),
            timestamp: Date.now()
          }
          await paymentsCollection.insertOne(paymentData)

          res.send({ transactionId: paymentIntentId, success: true });
        } else {
          res.status(400).send({ message: 'Payment not successful', success: false });
        }
      } catch (error) {
        console.error('Payment success error:', error);
        res.status(500).send({ message: error.message, success: false });
      }
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
    app.delete('/orders/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const requesterEmail = req.tokenEmail

      const targetOrder = await ordersCollection.findOne({ _id: new ObjectId(id) })
      if (!targetOrder) {
        return res.status(404).send({ message: 'Order not found' })
      }

      // Check role of requester
      const user = await usersCollection.findOne({ email: requesterEmail })
      const isAdmin = user && user.role === 'admin'

      const transactionId = targetOrder.transactionId

      // Define filter to cancel orders under the same transaction
      let filter = { transactionId: transactionId }
      if (!isAdmin && user && user.role === 'seller') {
        filter = {
          transactionId: transactionId,
          $or: [
            { seller: requesterEmail },
            { 'seller.email': requesterEmail }
          ]
        }
      }
      if (!isAdmin && (!user || user.role === 'customer')) {
        filter = {
          transactionId: transactionId,
          customer: requesterEmail
        }
      }

      const ordersToCancel = await ordersCollection.find(filter).toArray()
      if (ordersToCancel.length === 0) {
        return res.status(404).send({ message: 'No orders found to cancel' })
      }

      // Check if any order is already in progress or delivered
      const cannotCancel = ordersToCancel.some(
        order => order.status === 'Delivered' || order.status === 'In Progress'
      )
      if (cannotCancel) {
        return res
          .status(409)
          .send({ message: 'Cannot cancel once the product is in progress or delivered!' })
      }

      // Restore quantity for each plant
      for (const order of ordersToCancel) {
        await plantsCollection.updateOne(
          { _id: new ObjectId(order.plantId) },
          { $inc: { quantity: order.quantity } }
        )
      }

      const result = await ordersCollection.deleteMany(filter)
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
        status: null,
        address: null,
        timestamp: Date.now(),
      })
      res.send(result)
    })

    // update order status
    app.patch('/orders/status/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const status = req.body.status
      const requesterEmail = req.tokenEmail

      const targetOrder = await ordersCollection.findOne({ _id: new ObjectId(id) })
      if (!targetOrder) {
        return res.status(404).send({ message: 'Order not found' })
      }

      // Check role of requester
      const user = await usersCollection.findOne({ email: requesterEmail })
      const isAdmin = user && user.role === 'admin'

      const transactionId = targetOrder.transactionId

      // Define filter to update orders under the same transaction
      let filter = { transactionId: transactionId }
      if (!isAdmin && user && user.role === 'seller') {
        filter = {
          transactionId: transactionId,
          $or: [
            { seller: requesterEmail },
            { 'seller.email': requesterEmail }
          ]
        }
      }

      const result = await ordersCollection.updateMany(filter, { $set: { status: status } })
      res.send(result)
    })

    // Get seller's orders
    app.get('/manage-orders/:email', verifyJWT, async (req, res) => {
      const email = req.params.email
      // Handle seller as object with email property
      const query = {
        $or: [
          { seller: email },
          { 'seller.email': email }
        ]
      }
      const result = await ordersCollection.find(query).sort({ _id: -1 }).toArray()
      res.send(result)
    })

    // Get all orders for admin
    app.get('/admin-orders', verifyJWT, async (req, res) => {
      const result = await ordersCollection.find().sort({ _id: -1 }).toArray()
      res.send(result)
    })

    // Get customer's orders  
    app.get('/my-orders/:email', verifyJWT, async (req, res) => {
      const email = req.params.email
      const query = { customer: email }
      const result = await ordersCollection.find(query).sort({ _id: -1 }).toArray()
      res.send(result)
    })

    // Get all payments (admin)
    app.get('/payments', verifyJWT, async (req, res) => {
      const result = await paymentsCollection.find().sort({ timestamp: -1 }).toArray()
      res.send(result)
    })

    // Get customer's payment history
    app.get('/my-payments/:email', verifyJWT, async (req, res) => {
      const email = req.params.email
      const query = { customer: email }
      const result = await paymentsCollection.find(query).sort({ timestamp: -1 }).toArray()
      res.send(result)
    })

    // Get payment by transaction ID
    app.get('/payment/:transactionId', verifyJWT, async (req, res) => {
      const transactionId = req.params.transactionId
      const query = { paymentIntentId: transactionId }
      const result = await paymentsCollection.findOne(query)
      res.send(result)
    })


    // get all users
    // verifyAdmin
    app.get('/users', verifyJWT, async (req, res) => {
      const result = await usersCollection.find().toArray()
      res.send(result)
    })

    // delete user by id
    app.delete('/users/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await usersCollection.deleteOne(query)
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
        $set: { ...user, timestamp: Date.now() },
      }
      // If status is not provided (e.g. role update), clear the status
      if (!user.status) {
        updateDoc.$set.status = null
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

    // save a contact message
    app.post('/contact-messages', async (req, res) => {
      const message = req.body
      const result = await contactCollection.insertOne({
        ...message,
        createdAt: new Date(),
        timestamp: Date.now()
      })
      res.send(result)
    })

    // get all contact messages (admin only)
    app.get('/contact-messages', verifyJWT, async (req, res) => {
      const requesterEmail = req.tokenEmail
      const requesterUser = await usersCollection.findOne({ 
        email: { $regex: new RegExp(`^${requesterEmail}$`, 'i') } 
      })

      if (!requesterUser || requesterUser.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const result = await contactCollection.find().sort({ _id: -1 }).toArray()
      res.send(result)
    })

    // delete a contact message (admin only)
    app.delete('/contact-messages/:id', verifyJWT, async (req, res) => {
      const requesterEmail = req.tokenEmail
      const requesterUser = await usersCollection.findOne({ 
        email: { $regex: new RegExp(`^${requesterEmail}$`, 'i') } 
      })

      if (!requesterUser || requesterUser.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await contactCollection.deleteOne(query)
      res.send(result)
    })



    // --- Wishlist Endpoints ---
    app.post('/wishlist', verifyJWT, async (req, res) => {
      const wishlistItem = req.body
      const query = { email: wishlistItem.email, plantId: wishlistItem.plantId }
      const exist = await wishlistCollection.findOne(query)
      if (exist) {
        return res.status(409).send({ message: 'Already wishlisted!' })
      }
      const result = await wishlistCollection.insertOne({
        ...wishlistItem,
        timestamp: Date.now()
      })
      res.send(result)
    })

    app.get('/wishlist/:email', verifyJWT, async (req, res) => {
      const email = req.params.email
      const query = { email: email }
      const result = await wishlistCollection.find(query).toArray()
      res.send(result)
    })

    app.delete('/wishlist/:id', verifyJWT, async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await wishlistCollection.deleteOne(query)
      res.send(result)
    })

    // --- Reviews Endpoints ---
    app.post('/reviews', verifyJWT, async (req, res) => {
      const review = req.body
      const result = await reviewsCollection.insertOne({
        ...review,
        timestamp: Date.now(),
        createdAt: new Date()
      })
      res.send(result)
    })

    app.get('/reviews/:plantId', async (req, res) => {
      const plantId = req.params.plantId
      const query = { plantId: plantId }
      const result = await reviewsCollection.find(query).sort({ timestamp: -1 }).toArray()
      res.send(result)
    })

    // Get all reviews (Admin only)
    app.get('/all-reviews', verifyJWT, async (req, res) => {
      const requesterEmail = req.tokenEmail
      console.log('all-reviews hit. requesterEmail:', requesterEmail)
      const requesterUser = await usersCollection.findOne({ 
        email: { $regex: new RegExp(`^${requesterEmail}$`, 'i') } 
      })
      console.log('requesterUser:', requesterUser)
      if (!requesterUser || requesterUser.role !== 'admin') {
        console.log('Access forbidden. Role:', requesterUser?.role)
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const result = await reviewsCollection.find().sort({ timestamp: -1 }).toArray()
      console.log('Sending reviews count:', result.length)
      res.send(result)
    })

    // Delete a review (Admin only)
    app.delete('/reviews/:id', verifyJWT, async (req, res) => {
      const requesterEmail = req.tokenEmail
      const requesterUser = await usersCollection.findOne({ 
        email: { $regex: new RegExp(`^${requesterEmail}$`, 'i') } 
      })
      if (!requesterUser || requesterUser.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await reviewsCollection.deleteOne(query)
      res.send(result)
    })

    // --- Coupons Endpoints ---
    app.post('/coupons', verifyJWT, async (req, res) => {
      const requesterEmail = req.tokenEmail
      const requesterUser = await usersCollection.findOne({ 
        email: { $regex: new RegExp(`^${requesterEmail}$`, 'i') } 
      })
      if (!requesterUser || requesterUser.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const coupon = req.body
      const result = await couponsCollection.insertOne({
        ...coupon,
        code: coupon.code.toUpperCase(),
        timestamp: Date.now()
      })
      res.send(result)
    })

    app.get('/coupons', verifyJWT, async (req, res) => {
      const result = await couponsCollection.find().sort({ _id: -1 }).toArray()
      res.send(result)
    })

    app.delete('/coupons/:id', verifyJWT, async (req, res) => {
      const requesterEmail = req.tokenEmail
      const requesterUser = await usersCollection.findOne({ 
        email: { $regex: new RegExp(`^${requesterEmail}$`, 'i') } 
      })
      if (!requesterUser || requesterUser.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden access' })
      }
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const result = await couponsCollection.deleteOne(query)
      res.send(result)
    })

    app.post('/coupons/apply', async (req, res) => {
      const { code, cartTotal } = req.body
      if (!code) return res.status(400).send({ message: 'Coupon code required' })
      const query = { code: code.toUpperCase() }
      const coupon = await couponsCollection.findOne(query)
      if (!coupon) {
        return res.status(404).send({ message: 'Invalid coupon code', success: false })
      }
      let discount = 0
      if (coupon.discountType === 'percent') {
        discount = (parseFloat(coupon.discountAmount) / 100) * cartTotal
      } else {
        discount = parseFloat(coupon.discountAmount)
      }
      discount = Math.min(discount, cartTotal)
      const finalTotal = cartTotal - discount
      res.send({
        success: true,
        discount,
        finalTotal,
        discountType: coupon.discountType,
        discountAmount: coupon.discountAmount
      })
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

module.exports = app;
