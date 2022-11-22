const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express();
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
require('dotenv').config();
const stripe = require("stripe")(process.env.STIPE_SECRET_KEY);


// middleware
app.use(cors());
app.use(express.json());


app.get('/', (req, res)=>{
    res.send('doctors portal server is running')
});




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.og8pjeq.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next){
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send('unauthorized access')
    }
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function(err, decoded){
        if(err){
            return res.status(403).send('forbidden access')
        }
        req.decoded = decoded;
        next();
    })
}


async function run(){
    try{
        const appointmentOptionsCollection = client.db('doctorsPortal').collection('appointmentOptions');
        const bookingsCollection = client.db('doctorsPortal').collection('bookings');
        const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentsCollection = client.db('doctorsPortal').collection('payments');

        const verifyAdmin = async(req, res, next) =>{
            const decodedEmail = req.decoded.email;
            const query = {email: decodedEmail};
            const user = await usersCollection.findOne(query);
            if(user?.role !== 'admin'){
                return res.status(403).send('forbidden access')
            }
            next()
        }

        app.get('/appointmentOptions', async(req, res)=>{
            const date = req.query.data;
            console.log(date)
            const query = {};
            const options = await appointmentOptionsCollection.find(query).toArray();
            const bookedQuery = {appointmentDate: date};
            const alreadyBooked = await bookingsCollection.find(bookedQuery).toArray();
            // code carefully :D
            options.forEach(option => {
                const optionsBooked = alreadyBooked.filter(book => book.treatment === option.name)
                const bookedSlots = optionsBooked.map(book => book.slot)
                const  remainingSlot = option.slots.filter(slot =>!bookedSlots.includes(slot))
                option.slots = remainingSlot;
                // console.log("options booked", date, option.name, remainingSlot.length)
            })
            res.send(options)
        });

        /***
         * bookings api called
         * app.get('/bookings');
         * app.get(/bookings/:id);
         * app.post('/bookings')
         * app.patch('/bookings/:id')
         * app.delete('/bookings/:id')
         * */ 
        
        app.get('/bookings', verifyJWT, async(req, res)=>{
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            if(email !== decodedEmail){
                return res.status(403).send('forbidden access')
            }
            const query = {email: email};
            const result = await bookingsCollection.find(query).toArray()
            res.send(result);
        });

        // payment get way----
        app.get('/bookings/:id', async(req, res)=>{
            const id = req.params.id;
            const filter = {_id: ObjectId(id)};
            const result = await bookingsCollection.findOne(filter);
            res.send(result);
        })

        app.post('/bookings', async(req, res)=>{
            const booking = req.body;
            const query = { 
                appointmentDate : booking.appointmentDate,
                email : booking.email,
                treatment : booking.treatment
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if(alreadyBooked.length){
                const message = `You already have a booked on ${booking.appointmentDate}`
                return res.send({acknowledged: false, message})
            }
            const result = await bookingsCollection.insertOne(booking);
            res.send(result)
        });


        // confirm card secret----- stripe
        app.post('/create-payment-intent', async(req, res)=>{
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount : amount,
                currency: "usd",
                "payment_method_types": [
                    "card"
                ],
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
              });
        });

        // pay payment details
        app.post('/payments', async (req, res) =>{
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId
            const filter = {_id: ObjectId(id)}
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            res.send(result);
        })


        // users create information
        app.get('/jwt', async(req, res)=>{
            const email = req.query.email;
            const query = {email: email};
            const user = await usersCollection.findOne(query);

            if(user){
                const token = jwt.sign({email}, process.env.ACCESS_TOKEN, {expiresIn: '2h'});
                return res.send({accessToken: token})
            }
            return res.status(403).send({accessToken: ''})
        })


        app.get('/users', async(req, res)=>{
            const query = {};
            const user = await usersCollection.find(query).toArray();
            res.send(user)
            
        })

        app.post('/users', async(req, res)=>{
            const user = req.body;
            const cursor = await usersCollection.insertOne(user);
            res.send(cursor);
        });

        app.get('/users/admin/:email', async(req, res)=>{
            const email = req.params.email;
            const query = {email};
            const user = await usersCollection.findOne(query);
            res.send({isAdmin: user?.role === 'admin'});
        })

        app.put('/users/admin/:id', verifyJWT, verifyAdmin, async(req, res)=>{
            const id = req.params.id;
            const filter = {_id: ObjectId(id)};
            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        })


        // temporary---
        // app.get('/addprice', async(req, res)=>{
        //     const filter = {};
        //     const options = {upsert: true};
        //     const updateDoc ={
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionsCollection.updateMany(filter, updateDoc, options);
        //     res.send(result)
        // })

        //doctors
        app.get('/appointmentAddDoctors', async(req, res)=>{
            const query = {};
            const result = await appointmentOptionsCollection.find(query).project({name: 1}).toArray();
            res.send(result);
        });

        app.get('/doctors', verifyJWT, verifyAdmin, async(req, res)=>{
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        })
        app.post('/doctors', verifyJWT, verifyAdmin, async(req, res)=>{
            const doctors = req.body;
            const cursor = await doctorsCollection.insertOne(doctors);
            res.send(cursor);
        });

        app.delete('/doctors/:id', verifyJWT, verifyAdmin, async(req, res)=>{
            const id = req.params.id;
            const query = { _id: ObjectId(id)};
            const result = await doctorsCollection.deleteOne(query);
            res.send(result);
        })

    }
    finally{

    }
}
run().catch((err)=>console.log(err));


app.listen(port, ()=>{
    console.log(`doctors portal server in running in port ${port}`)
})